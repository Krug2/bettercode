export const RELAY_VERSION = 1
export const RELAY_FRAME_LIMIT = 64 * 1024
export const RELAY_QUEUE_LIMIT = 4 * 1024 * 1024
export const RELAY_CHANNEL_BYTES = 16
export const RELAY_HANDSHAKE_TIMEOUT = 15_000

export function relayUrl(value: string): string {
  const url = new URL(value.trim())
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (
    !["wss:", "https:", ...(loopback ? ["ws:", "http:"] : [])].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) throw new Error("Use a secure relay address without a path or credentials")
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:"
  return url.origin
}

export function channelFrame(id: string, data: Uint8Array): Buffer {
  if (!/^[a-f0-9]{32}$/.test(id) || !data.byteLength || data.byteLength > RELAY_FRAME_LIMIT - RELAY_CHANNEL_BYTES)
    throw new Error("Invalid relay frame")
  return Buffer.concat([Buffer.from(id, "hex"), data])
}

export function readChannelFrame(data: Buffer): { id: string; data: Buffer } {
  if (data.length <= RELAY_CHANNEL_BYTES || data.length > RELAY_FRAME_LIMIT)
    throw new Error("Invalid relay frame")
  return { id: data.subarray(0, RELAY_CHANNEL_BYTES).toString("hex"), data: data.subarray(RELAY_CHANNEL_BYTES) }
}
