import { sign, X509Certificate } from "node:crypto"
import { Duplex } from "node:stream"
import WebSocket from "ws"
import { channelFrame, readChannelFrame, relayUrl, RELAY_FRAME_LIMIT, RELAY_HANDSHAKE_TIMEOUT, RELAY_QUEUE_LIMIT, RELAY_VERSION } from "@betterc0de/remote-protocol"
import { certificateId, type DeviceIdentity } from "./identity"

class RelayStream extends Duplex {
  constructor(private readonly socket: WebSocket, private readonly id?: string) {
    super({ highWaterMark: 64 * 1024 })
    this.on("error", () => undefined)
  }

  _read(): void {}

  receive(data: Buffer): void {
    if (this.destroyed) return
    if (this.readableLength + data.length > RELAY_QUEUE_LIMIT) {
      this.destroy(new Error("Device receive queue exceeded"))
      return
    }
    this.push(data)
  }

  _write(data: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    let offset = 0
    const next = (error?: Error | null) => {
      if (error) return callback(error)
      if (offset === data.length) return callback()
      if (this.socket.readyState !== WebSocket.OPEN) return callback(new Error("Relay disconnected"))
      const chunk = data.subarray(offset, offset + RELAY_FRAME_LIMIT - 16)
      offset += chunk.length
      const frame = this.id ? channelFrame(this.id, chunk) : chunk
      if (this.socket.bufferedAmount + frame.length > RELAY_QUEUE_LIMIT) return callback(new Error("Device send queue exceeded"))
      this.socket.send(frame, next)
    }
    next()
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    if (this.id && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "close", id: this.id }), () => undefined)
    } else if (!this.id) this.socket.terminate()
    callback(error)
  }
}

export interface RelayRegistration {
  closed: Promise<void>
  close(): void
}

function openRelay(address: string, signal?: AbortSignal): WebSocket {
  signal?.throwIfAborted()
  const socket = new WebSocket(`${relayUrl(address)}/v1/relay`, {
    maxPayload: RELAY_FRAME_LIMIT, perMessageDeflate: false, handshakeTimeout: RELAY_HANDSHAKE_TIMEOUT,
    followRedirects: false,
  })
  const abort = () => socket.terminate()
  signal?.addEventListener("abort", abort, { once: true })
  let heartbeat: NodeJS.Timeout
  const alive = () => {
    clearTimeout(heartbeat)
    heartbeat = setTimeout(() => socket.terminate(), 75_000)
    heartbeat.unref()
  }
  socket.on("open", alive)
  socket.on("ping", alive)
  socket.on("error", () => undefined)
  socket.once("close", () => { clearTimeout(heartbeat); signal?.removeEventListener("abort", abort) })
  return socket
}

function handshake(
  socket: WebSocket,
  identity: DeviceIdentity | string,
  ready: (value: Record<string, unknown>) => void,
  message: (data: Buffer, binary: boolean) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let phase = 0
    const failed = () => reject(new Error("Relay unavailable or connection refused"))
    const timeout = setTimeout(() => { failed(); socket.terminate() }, RELAY_HANDSHAKE_TIMEOUT)
    const clean = () => { clearTimeout(timeout); socket.off("error", failed); socket.off("close", failed) }
    socket.once("error", failed)
    socket.once("close", failed)
    socket.once("close", clean)
    socket.on("message", (raw, binary) => {
      try {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
        if (phase === 2) { message(data, binary); return }
        if (binary || data.length > 4096) throw new Error("Invalid relay greeting")
        const value = JSON.parse(data.toString())
        if (value?.version !== RELAY_VERSION) throw new Error("Incompatible relay version")
        if (phase === 0) {
          if (value.type !== "challenge" || typeof value.challenge !== "string" || !/^[\w-]{43}$/.test(value.challenge))
            throw new Error("Invalid relay challenge")
          phase = 1
          const request = typeof identity === "string"
            ? { type: "connect", version: RELAY_VERSION, hostId: identity }
            : {
                type: "register", version: RELAY_VERSION,
                publicKey: new X509Certificate(identity.certificate).publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
                signature: sign("sha256", Buffer.from(`bettercode-relay-v1:${value.challenge}`), identity.privateKey).toString("base64url"),
              }
          socket.send(JSON.stringify(request))
        } else {
          ready(value)
          phase = 2
          clean()
          resolve()
        }
      } catch (error) {
        clean()
        reject(error)
        socket.terminate()
      }
    })
  })
}

export async function registerRelayHost(
  address: string, identity: DeviceIdentity, accept: (stream: Duplex) => void, signal?: AbortSignal,
): Promise<RelayRegistration> {
  const socket = openRelay(address, signal)
  const streams = new Map<string, RelayStream>()
  const closed = new Promise<void>(resolve => socket.once("close", () => {
    for (const stream of streams.values()) stream.destroy()
    streams.clear()
    resolve()
  }))
  await handshake(socket, identity, value => {
    if (value.type !== "registered" || value.id !== certificateId(identity.certificate)) throw new Error("Relay registration failed")
  }, (data, binary) => {
    if (binary) {
      const frame = readChannelFrame(data)
      streams.get(frame.id)?.receive(frame.data)
      return
    }
    if (data.length > 4096) throw new Error("Relay control frame too large")
    const value = JSON.parse(data.toString())
    if (!value || typeof value.id !== "string" || !/^[a-f0-9]{32}$/.test(value.id)) throw new Error("Invalid relay channel")
    if (value.type === "close") { streams.get(value.id)?.destroy(); return }
    if (value.type !== "open" || streams.has(value.id) || streams.size >= 16) throw new Error("Invalid relay channel")
    const stream = new RelayStream(socket, value.id)
    streams.set(value.id, stream)
    stream.once("close", () => streams.delete(value.id))
    accept(stream)
  })
  return { closed, close: () => socket.terminate() }
}

export async function connectRelay(address: string, hostId: string, signal?: AbortSignal): Promise<Duplex> {
  if (!/^[a-f0-9]{64}$/.test(hostId)) throw new Error("Invalid device identity")
  const socket = openRelay(address, signal)
  const stream = new RelayStream(socket)
  socket.once("close", () => stream.destroy())
  try {
    await handshake(socket, hostId, value => {
      if (value.type !== "connected") throw new Error("Device unavailable")
    }, (data, binary) => {
      if (!binary) throw new Error("Unexpected relay control frame")
      stream.receive(data)
    })
    return stream
  } catch (error) { stream.destroy(); throw error }
}
