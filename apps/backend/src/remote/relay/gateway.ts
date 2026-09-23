import type { IncomingHttpHeaders, ServerHttp2Session, ServerHttp2Stream } from "node:http2"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import WebSocket from "ws"
import { z } from "zod"
import type { RemoteAccessService } from "../service"
import { bridgeEvents } from "./event-stream"
import { acceptDeviceSession, DeviceRequestError, readBody } from "./http-channel"
import { DevicePairing, deviceLabel } from "./pairing"
import { certificateId } from "./identity"
import type { SecurePeer } from "./tls-channel"
import type { DeviceGrant, DeviceVault } from "./vault"

export interface DeviceGatewayOptions {
  vault: DeviceVault
  access: RemoteAccessService
  pairing: DevicePairing
  label(): string
  enabled(): boolean
  localPort(): number
  fetch(request: Request): Response | Promise<Response>
}

function json(stream: ServerHttp2Stream, value: unknown, status = 200): void {
  if (stream.destroyed || stream.closed) return
  stream.respond({ ":status": status, "content-type": "application/json", "cache-control": "no-store" })
  stream.end(JSON.stringify(value))
}

export function allowedDevicePath(value: string): boolean {
  if (value.length > 8192 || !value.startsWith("/api/v1/") || value.includes("\\") || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  try {
    const url = new URL(value, "https://bettercode.remote")
    if (url.origin !== "https://bettercode.remote" || `${url.pathname}${url.search}` !== value || /%2f|%5c|%2e/i.test(url.pathname)) return false
    const path = decodeURIComponent(url.pathname)
    return !/^\/api\/v1\/(?:devices|remote)(?:\/|$)/.test(path) || path === "/api/v1/remote/bootstrap"
  } catch { return false }
}

export function acceptDeviceGateway(peer: SecurePeer, options: DeviceGatewayOptions): ServerHttp2Session {
  const session = acceptDeviceSession(peer)
  let grant: DeviceGrant | undefined
  let authorizing = false
  const deadline = setTimeout(() => { if (!grant) session.destroy() }, 120_000)
  deadline.unref()
  const unsubscribe = options.access.subscribeToSessionRevocations(ids => {
    if (grant && ids.includes(grant.sessionId)) session.destroy()
  })
  session.once("close", () => { clearTimeout(deadline); unsubscribe() })
  session.on("stream", (stream, headers) => {
    const abort = new AbortController()
    stream.once("close", () => abort.abort())
    stream.setTimeout(120_000, () => stream.destroy())
    void handle(stream, headers, abort.signal).catch(error => {
      if (stream.headersSent) stream.close()
      else json(stream, { error: error instanceof DeviceRequestError ? error.message : "Device request failed" }, error instanceof DeviceRequestError ? error.status : 400)
    })
  })

  async function handle(stream: ServerHttp2Stream, headers: IncomingHttpHeaders, signal: AbortSignal): Promise<void> {
    if (!options.enabled()) throw new DeviceRequestError("Device sharing is disabled", 403)
    const method = headers[":method"]
    const path = headers[":path"]
    if (method === "POST" && (path === "/_device/pair" || path === "/_device/connect")) {
      if (authorizing || grant) throw new DeviceRequestError("Device already connected", 409)
      authorizing = true
      try {
        const body = JSON.parse((await readBody(stream, 16 * 1024)).toString())
        if (path === "/_device/pair") {
          const value = z.object({ token: z.string().regex(/^[\w-]{43}$/), label: deviceLabel }).parse(body)
          grant = await options.pairing.request(peer, value.token, value.label, signal)
        } else {
          grant = options.vault.grants().find(value => value.id === peer.id)
        }
        if (!grant || !options.access.isSessionActive(grant.sessionId)) { grant = undefined; throw new DeviceRequestError("Device approval has expired or was revoked", 403) }
        clearTimeout(deadline)
        json(stream, {
          version: 1, id: certificateId((await options.vault.identity()).certificate), label: options.label(), environmentId: options.access.environmentId(),
          accessLevel: grant.accessLevel, allowTerminal: grant.allowTerminal, expiresAt: grant.expiresAt,
        })
      } finally { authorizing = false }
      return
    }
    if (!grant || !options.access.isSessionActive(grant.sessionId)) throw new DeviceRequestError("Device approval is required", 403)
    if (method === "CONNECT" && headers[":authority"] === "events") {
      stream.setTimeout(0)
      const socket = new WebSocket(`ws://127.0.0.1:${options.localPort()}/ws`, {
        headers: { Authorization: `Bearer ${grant.sessionToken}` },
        maxPayload: 4 * 1024 * 1024, perMessageDeflate: false, handshakeTimeout: 10_000,
      })
      bridgeEvents(stream, socket)
      socket.once("open", () => { if (!stream.destroyed) stream.respond({ ":status": 200 }) })
      return
    }
    if (typeof path !== "string" || !allowedDevicePath(path) || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method ?? ""))
      throw new DeviceRequestError("Device route is unavailable", 403)
    if (!grant.allowTerminal && /^\/api\/v1\/(?:shell|terminal)(?:\/|$)/.test(decodeURIComponent(new URL(path, "https://bettercode.remote").pathname)))
      throw new DeviceRequestError("Terminal access is disabled for this device", 403)
    const body = await readBody(stream, 2 * 1024 * 1024)
    signal.throwIfAborted()
    const requestHeaders = new Headers({ Authorization: `Bearer ${grant.sessionToken}` })
    for (const key of ["content-type", "accept", "range", "if-none-match", "idempotency-key"]) {
      if (typeof headers[key] === "string") requestHeaders.set(key, headers[key])
    }
    const request = new Request(`https://bettercode.remote${path}`, {
      method, headers: requestHeaders, signal,
      ...(method !== "GET" && method !== "HEAD" && body.length ? { body } : {}),
    })
    const response = await options.fetch(request)
    if (stream.destroyed) { await response.body?.cancel(); return }
    const responseHeaders: Record<string, string | number> = { ":status": response.status }
    for (const key of ["content-type", "content-length", "content-disposition", "content-range", "etag", "retry-after"]) {
      const value = response.headers.get(key)
      if (value) responseHeaders[key] = value
    }
    stream.respond(responseHeaders)
    if (response.body && method !== "HEAD") await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), stream)
    else stream.end()
  }
  return session
}
