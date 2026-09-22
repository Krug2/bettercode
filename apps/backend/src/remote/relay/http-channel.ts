import http2, { type ClientHttp2Session, type ClientHttp2Stream, type Http2Session, type ServerHttp2Session } from "node:http2"
import { Duplex, type Readable } from "node:stream"
import type { SecurePeer } from "./tls-channel"

const options = {
  maxSessionMemory: 8,
  maxHeaderListPairs: 32,
  settings: { enablePush: false, maxConcurrentStreams: 32, maxHeaderListSize: 8192 },
}

function monitor(session: Http2Session): void {
  session.on("error", () => session.destroy())
  session.on("goaway", () => session.destroy())
  session.on("stream", stream => stream.on("error", () => undefined))
  let pending = false
  const heartbeat = setInterval(() => {
    if (pending || session.destroyed || session.closed) { session.destroy(); return }
    pending = true
    session.ping(error => { pending = false; if (error) session.destroy() })
  }, 20_000)
  heartbeat.unref()
  session.once("close", () => clearInterval(heartbeat))
}

export function acceptDeviceSession(peer: SecurePeer): ServerHttp2Session {
  const stream = Duplex.from({ readable: peer.socket, writable: peer.socket })
  const session = http2.performServerHandshake(stream, options)
  monitor(session)
  return session
}

export function openDeviceSession(peer: SecurePeer): ClientHttp2Session {
  const session = http2.connect("https://bettercode.remote", { ...options, createConnection: () => peer.socket })
  monitor(session)
  return session
}

export async function readBody(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error("Device message is too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size)
}

export class DeviceRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function requestDevice(session: ClientHttp2Session, path: string, method = "GET"): ClientHttp2Stream {
  const stream = session.request({ ":path": path, ":method": method })
  stream.on("error", () => undefined)
  stream.setTimeout(120_000, () => stream.destroy(new Error("Device request timed out")))
  return stream
}

export async function deviceJson(session: ClientHttp2Session, path: string, body: unknown): Promise<unknown> {
  const stream = requestDevice(session, path, "POST")
  let status = 0
  stream.once("response", headers => { status = Number(headers[":status"]) })
  stream.end(JSON.stringify(body))
  try {
    const value = JSON.parse((await readBody(stream, 16 * 1024)).toString())
    if (status !== 200) throw new DeviceRequestError(typeof value?.error === "string" ? value.error : "Device request refused", status)
    return value
  } finally { stream.close() }
}
