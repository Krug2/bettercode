import type { Duplex } from "node:stream"
import type WebSocket from "ws"

const MAX_EVENT_BYTES = 4 * 1024 * 1024

export function bridgeEvents(stream: Duplex, socket: WebSocket): void {
  const header = Buffer.alloc(4)
  let headerOffset = 0
  let payload: Buffer | undefined
  let offset = 0
  const close = () => { stream.destroy(); socket.terminate() }
  stream.on("error", close)
  stream.once("close", close)
  socket.on("error", close)
  socket.once("close", close)
  stream.on("drain", () => socket.resume())
  socket.on("message", (raw, binary) => {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
    if (binary || data.length > MAX_EVENT_BYTES || stream.writableLength + data.length > MAX_EVENT_BYTES) { close(); return }
    const frame = Buffer.allocUnsafe(data.length + 4)
    frame.writeUInt32BE(data.length)
    data.copy(frame, 4)
    if (!stream.write(frame)) socket.pause()
  })
  stream.on("data", (data: Buffer) => {
    try {
      let index = 0
      while (index < data.length) {
        if (!payload) {
          const length = Math.min(4 - headerOffset, data.length - index)
          data.copy(header, headerOffset, index, index + length)
          index += length
          headerOffset += length
          if (headerOffset < 4) continue
          const size = header.readUInt32BE()
          if (!size || size > MAX_EVENT_BYTES) throw new Error("Invalid device event")
          payload = Buffer.allocUnsafe(size)
          offset = 0
        }
        const length = Math.min(payload.length - offset, data.length - index)
        data.copy(payload, offset, index, index + length)
        index += length
        offset += length
        if (offset === payload.length) {
          const text = payload.toString("utf8")
          const value = JSON.parse(text)
          if (value?.type !== "auth") {
            if (socket.bufferedAmount + payload.length > MAX_EVENT_BYTES) throw new Error("Device event queue exceeded")
            socket.send(text, error => { if (error) close() })
          }
          payload = undefined
          headerOffset = 0
        }
      }
    } catch { close() }
  })
}
