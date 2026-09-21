import type { ConnectionProfile } from "@/types/remote"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RemoteSocket } from "./remote-socket"

class FakeSocket {
  static CLOSING = 2
  static instances: FakeSocket[] = []
  readyState = 1
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 2
  })
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  constructor() {
    FakeSocket.instances.push(this)
  }
  frame(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  authenticate(journalId = "journal", latestSequence = 0) {
    this.frame({ type: "auth_ok", replay: { journalId, latestSequence } })
  }
}

const profile: ConnectionProfile = {
  baseUrl: "https://desktop.example",
  environmentId: "test",
  sessionToken: "test-token",
  pairedAt: "2026-09-05",
  session: {
    id: "session",
    label: "phone",
    createdAt: "2026-09-05",
    lastSeenAt: "2026-09-05",
    expiresAt: "2026-09-06",
  },
}

const event = (sequence: number, journalId = "journal") => ({
  channel: "provider.runtimeEvent",
  sequence,
  journalId,
  data: {
    event_type: "content_delta",
    thread_id: "thread",
    payload: { delta: "x" },
  },
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal("WebSocket", FakeSocket)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  const onFrame = vi.fn()
  const onState = vi.fn()
  const client = new RemoteSocket(profile, { onFrame, onState })
  client.start()
  return { client, socket: FakeSocket.instances[0]!, onFrame, onState }
}

describe("mobile socket lifecycle and replay", () => {
  it("ignores every callback from a stopped connection", () => {
    const { client, socket, onFrame, onState } = setup()
    socket.authenticate()
    client.stop()
    socket.send.mockClear()
    onState.mockClear()
    socket.onopen?.()
    socket.frame(event(1))
    socket.onerror?.()
    socket.onclose?.({ code: 1006 })
    expect(socket.send).not.toHaveBeenCalled()
    expect(onFrame).not.toHaveBeenCalled()
    expect(onState).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("ignores a replaced socket without hiding events from its replacement", () => {
    const { client, socket, onFrame } = setup()
    socket.authenticate()
    client.reconnectNow()
    const replacement = FakeSocket.instances[1]!
    replacement.authenticate()
    socket.frame(event(100))
    socket.onclose?.({ code: 1006 })
    replacement.frame(event(1))
    expect(onFrame).toHaveBeenCalledExactlyOnceWith(event(1))
    expect(vi.getTimerCount()).toBe(0)
  })

  it("announces missing events before delivering the next frame and deduplicates", () => {
    const { socket, onFrame } = setup()
    socket.authenticate()
    socket.frame(event(1))
    socket.frame(event(3))
    socket.frame(event(3))
    expect(onFrame).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "provider_replay_gap",
        reason: "sequence_gap",
        requestedAfterSequence: 1,
      })
    )
    expect(onFrame).toHaveBeenNthCalledWith(3, event(3))
    expect(onFrame).toHaveBeenCalledTimes(3)
  })

  it("resets a cursor ahead of the current journal", () => {
    const { client, socket, onFrame } = setup()
    socket.authenticate("journal", 10)
    socket.frame(event(10))
    onFrame.mockClear()
    client.reconnectNow()
    const replacement = FakeSocket.instances[1]!
    replacement.authenticate("journal", 5)
    expect(replacement.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "provider_replay",
        journalId: "journal",
        afterSequence: 0,
      })
    )
    replacement.frame(event(1))
    expect(onFrame).toHaveBeenCalledExactlyOnceWith(event(1))
  })

  it("negotiates a backend restart using the previous journal identity", () => {
    const { client, socket, onFrame } = setup()
    socket.authenticate()
    socket.frame(event(1))
    client.reconnectNow()
    const replacement = FakeSocket.instances[1]!
    replacement.authenticate("new-journal")
    expect(replacement.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "provider_replay",
        journalId: "journal",
        afterSequence: 1,
      })
    )
    replacement.frame(event(1, "new-journal"))
    expect(onFrame).toHaveBeenLastCalledWith(event(1, "new-journal"))
  })

  it("does not acknowledge a frame its consumer could not apply", () => {
    const { client, socket, onFrame } = setup()
    socket.authenticate()
    onFrame.mockImplementationOnce(() => {
      throw new Error("store unavailable")
    })
    expect(() => socket.frame(event(1))).toThrow("store unavailable")
    client.reconnectNow()
    const replacement = FakeSocket.instances[1]!
    replacement.authenticate("journal", 1)
    expect(replacement.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "provider_replay",
        journalId: "journal",
        afterSequence: 0,
      })
    )
    replacement.frame(event(1))
    expect(onFrame).toHaveBeenCalledTimes(2)
  })

  it("stops retrying after the host refuses the session and lets the caller decide", () => {
    const onUnauthorized = vi.fn()
    const onState = vi.fn()
    const client = new RemoteSocket(profile, {
      onFrame: vi.fn(),
      onState,
      onUnauthorized,
    })
    client.start()
    const socket = FakeSocket.instances[0]!
    socket.onclose?.({ code: 4401 })
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(onState).toHaveBeenLastCalledWith("error")
    // No retry ladder: the same token can only be refused again.
    expect(vi.getTimerCount()).toBe(0)

    // The caller re-checked the session and asked for an explicit retry;
    // from there an ordinary drop reconnects as usual.
    client.reconnectNow()
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1]!.onclose?.({ code: 1006 })
    expect(vi.getTimerCount()).toBe(1)
    client.stop()
  })

  it("closes a socket that never completes the auth handshake", () => {
    const { socket } = setup()
    vi.advanceTimersByTime(10_000)
    expect(socket.close).toHaveBeenCalledWith(4000, "auth handshake timed out")
    socket.onclose?.({ code: 4000 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it("keeps an authenticated socket open past the handshake window", () => {
    const { socket } = setup()
    socket.authenticate()
    vi.advanceTimersByTime(10_000)
    expect(socket.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels scheduled reconnects when stopped", () => {
    const { client, socket } = setup()
    socket.onclose?.({ code: 1006 })
    expect(vi.getTimerCount()).toBe(1)
    client.stop()
    vi.runAllTimers()
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
