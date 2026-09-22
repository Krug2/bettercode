import { describe, expect, it } from "vitest"
import { channelFrame, readChannelFrame, relayUrl, RELAY_FRAME_LIMIT } from "./index"

describe("relay framing", () => {
  it("preserves binary payloads and channel identities", () => {
    const id = "ab".repeat(16)
    const data = Buffer.from([0, 255, 10, 13])
    expect(readChannelFrame(channelFrame(id, data))).toEqual({ id, data })
  })

  it("rejects malformed and oversized frames", () => {
    expect(() => readChannelFrame(Buffer.alloc(16))).toThrow()
    expect(() => readChannelFrame(Buffer.alloc(RELAY_FRAME_LIMIT + 1))).toThrow()
    expect(() => channelFrame("a", Buffer.alloc(1))).toThrow()
    expect(() => channelFrame("ab".repeat(16), Buffer.alloc(RELAY_FRAME_LIMIT))).toThrow()
  })

  it("requires encrypted public endpoints and keeps loopback development local", () => {
    expect(relayUrl("https://relay.example")).toBe("wss://relay.example")
    expect(relayUrl("http://127.0.0.1:9000")).toBe("ws://127.0.0.1:9000")
    for (const value of ["http://relay.example", "https://user:secret@relay.example", "https://relay.example/path", "https://relay.example?token=secret", "file:///tmp/relay"])
      expect(() => relayUrl(value)).toThrow()
  })
})
