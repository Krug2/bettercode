import type http from "node:http"
import { randomBytes } from "node:crypto"
import { Readable } from "node:stream"
import type { IncomingHttpHeaders } from "node:http2"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { WebSocketServer } from "ws"
import { readCookie } from "../../security/cookie"
import type { ServerConfig } from "../../config"
import { registerRemoteWebRoutes } from "../web"
import { allowedDevicePath } from "./gateway"
import { bridgeEvents } from "./event-stream"
import { requestDevice } from "./http-channel"
import type { ConnectedHost } from "./manager"
import type { SavedHost } from "./vault"

const COOKIE = "bettercode_device_view"

export async function createViewerBridge(options: {
  host: SavedHost; webRoot: string; connect(): Promise<ConnectedHost>; connectionState(): string;
}) {
  const app = new Hono()
  const invitations = new Map<string, number>()
  const cookies = new Map<string, number>()
  let origin = ""
  let closed = false
  const config = { port: 0 } as ServerConfig
  const authenticated = (token?: string | null) => Boolean(token && (cookies.get(token) ?? 0) > Date.now())
  const bootstrap = (authorized: boolean) => ({
    enabled: true, authenticated: authorized, authentication: authorized ? "remote" : null,
    environmentId: authorized ? options.host.environmentId : null,
    session: authorized ? { id: options.host.id, label: options.host.label, accessLevel: options.host.accessLevel, expiresAt: options.host.expiresAt } : null,
    ...(authorized ? { device: { id: options.host.id, label: options.host.label, state: options.connectionState() } } : {}),
  })
  app.use("*", async (c, next) => {
    const requestOrigin = c.req.header("origin")
    if (closed || c.req.header("host") !== new URL(origin).host || (requestOrigin && requestOrigin !== origin))
      return c.json({ error: "Invalid device view origin" }, 403)
    if (!["GET", "HEAD"].includes(c.req.method) && requestOrigin !== origin) return c.json({ error: "Device view origin is required" }, 403)
    c.header("Referrer-Policy", "no-referrer")
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
    c.header("Cache-Control", "no-store")
    return next()
  })
  app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: c => c.json({ error: "Request is too large" }, 413) }))
  app.get("/api/v1/remote/bootstrap", c => c.json(bootstrap(authenticated(getCookie(c, COOKIE)))))
  app.post("/api/v1/remote/pair", async c => {
    const value = await c.req.json().catch(() => ({}))
    if (typeof value.credential !== "string" || (invitations.get(value.credential) ?? 0) <= Date.now()) return c.json({ error: "Reopen this device from settings" }, 403)
    invitations.delete(value.credential)
    const token = randomBytes(32).toString("base64url")
    for (const [key, expires] of cookies) if (expires <= Date.now()) cookies.delete(key)
    if (cookies.size >= 16) cookies.delete(cookies.keys().next().value!)
    cookies.set(token, Date.now() + 24 * 60 * 60_000)
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 24 * 60 * 60 })
    return c.json(bootstrap(true))
  })
  app.use("/api/*", async (c, next) => {
    if (!authenticated(getCookie(c, COOKIE))) return c.json({ error: "Reopen this device from settings" }, 401)
    return next()
  })
  app.post("/api/v1/remote/logout", c => {
    cookies.delete(getCookie(c, COOKIE) ?? "")
    deleteCookie(c, COOKIE, { path: "/" })
    return c.json({ loggedOut: true })
  })
  app.get("/api/v1/remote/status", c => c.json({
    enabled: true, authentication: "remote", listeningOnNetwork: false, endpoints: [],
    environmentId: options.host.environmentId, host: options.host.label, port: 0, currentSessionId: options.host.id,
  }))
  app.all("/api/*", async c => {
    const path = new URL(c.req.url).pathname + new URL(c.req.url).search
    if (!allowedDevicePath(path)) return c.json({ error: "Manage devices on the local computer" }, 403)
    let request: ReturnType<typeof requestDevice> | undefined
    const abort = () => request?.close()
    try {
      const requestBody = ["GET", "HEAD"].includes(c.req.method) ? undefined : Buffer.from(await c.req.arrayBuffer())
      const requestHeaders: Record<string, string> = {}
      for (const key of ["content-type", "accept", "range", "if-none-match", "idempotency-key"]) {
        const value = c.req.header(key)
        if (value) requestHeaders[key] = value
      }
      const connection = await options.connect()
      c.req.raw.signal.throwIfAborted()
      request = requestDevice(connection.session, path, c.req.method, requestHeaders)
      const response = new Promise<IncomingHttpHeaders>((resolve, reject) => {
        request!.once("response", resolve)
        request!.once("error", reject)
        request!.once("close", () => reject(new Error("Device connection closed")))
      })
      c.req.raw.signal.addEventListener("abort", abort, { once: true })
      request.once("close", () => c.req.raw.signal.removeEventListener("abort", abort))
      request.end(requestBody)
      const headers = await response
      const output = new Headers()
      for (const key of ["content-type", "content-length", "content-disposition", "content-range", "etag", "retry-after"])
        if (typeof headers[key] === "string") output.set(key, headers[key])
      const status = Number(headers[":status"]) || 502
      const body = c.req.method === "HEAD" || [204, 304].includes(status) ? null : Readable.toWeb(request) as ReadableStream<Uint8Array>
      if (!body) request.resume()
      return new Response(body, { status, headers: output })
    } catch {
      request?.close()
      return c.json({ error: ["GET", "HEAD"].includes(c.req.method) ? "Device is offline. Reconnecting..." : "Connection interrupted. Check the host before repeating this action." }, 503)
    }
  })
  registerRemoteWebRoutes(app, config, options.webRoot)
  const listen = (port: number) => new Promise<http.Server>((resolve, reject) => {
    const listening = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, info => {
      config.port = info.port
      origin = `http://device-${options.host.id.slice(0, 32)}.localhost:${info.port}`
      resolve(listening as http.Server)
    })
    listening.once("error", reject)
  })
  let server: http.Server
  try { server = await listen(options.host.viewerPort ?? 0) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || !options.host.viewerPort) throw error
    server = await listen(0)
  }
  server.requestTimeout = 120_000
  server.headersTimeout = 10_000
  const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 })
  server.on("upgrade", (req, socket, head) => {
    if (closed || req.url !== "/ws" || req.headers.host !== new URL(origin).host || req.headers.origin !== origin || !authenticated(readCookie(req.headers.cookie, COOKIE))) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      return
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      ws.on("error", () => ws.terminate())
      void options.connect().then(connection => {
        if (ws.readyState !== ws.OPEN) return
        const stream = connection.session.request({ ":method": "CONNECT", ":authority": "events" })
        stream.on("error", () => ws.terminate())
        stream.once("response", headers => { if (headers[":status"] !== 200) { stream.close(); ws.terminate() } })
        bridgeEvents(stream, ws)
      }).catch(() => ws.terminate())
    })
  })
  return {
    origin,
    open(): string {
      if (closed) throw new Error("Device view is closed")
      for (const [key, expires] of invitations) if (expires <= Date.now()) invitations.delete(key)
      if (invitations.size >= 8) invitations.delete(invitations.keys().next().value!)
      const token = randomBytes(32).toString("base64url")
      invitations.set(token, Date.now() + 60_000)
      return `${origin}/#token=${token}`
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      invitations.clear()
      cookies.clear()
      for (const socket of sockets.clients) socket.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

export type ViewerBridge = Awaited<ReturnType<typeof createViewerBridge>>
