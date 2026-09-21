import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DeepgramSession } from "./deepgram-session"

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3 })
  constructor() { FakeSocket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  result(transcript: string, final: boolean) {
    this.onmessage?.({ data: JSON.stringify({ type: "Results", is_final: final, channel: { alternatives: [{ transcript }] } }) })
  }
  serverClose(code = 1000) { this.readyState = 3; this.onclose?.({ code }) }
}

class FakeRecorder {
  static instances: FakeRecorder[] = []
  static isTypeSupported() { return true }
  state = "inactive"
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { FakeRecorder.instances.push(this) }
  start() { this.state = "recording" }
  stop = vi.fn(() => { this.state = "inactive" })
  flush() {
    this.ondataavailable?.({ data: new Blob(["last audio chunk"]) })
    this.onstop?.()
  }
}

class FakeStream {
  stop = vi.fn()
  getTracks() { return [{ stop: this.stop }] }
}

function setup(getStream?: () => Promise<MediaStream>) {
  const stream = new MediaStream()
  const callbacks = { onInterim: vi.fn(), onFinal: vi.fn(), onEnd: vi.fn() }
  const onPhase = vi.fn()
  const onError = vi.fn()
  const session = new DeepgramSession({
    language: "de", getStream: getStream ?? (async () => stream),
    getAuth: async () => ({ protocol: "token", credential: "test-only" }),
    callbacks, onPhase, onError,
  })
  return { session, callbacks, onPhase, onError, stream }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  FakeRecorder.instances = []
  vi.stubGlobal("WebSocket", FakeSocket)
  vi.stubGlobal("MediaRecorder", FakeRecorder)
  vi.stubGlobal("MediaStream", FakeStream)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("Deepgram recording lifecycle", () => {
  it("sends the final audio before CloseStream and receives final text after stopping", async () => {
    const { session, callbacks, onPhase, onError, stream } = setup()
    await session.start()
    const socket = FakeSocket.instances[0]!
    socket.open()
    socket.result("Hallo", false)
    expect(callbacks.onInterim).toHaveBeenCalledWith("Hallo")
    session.stop()
    session.stop()
    expect(onPhase).toHaveBeenLastCalledWith("finishing")
    expect(stream.getTracks()[0]?.stop).toHaveBeenCalled()
    expect(socket.send).not.toHaveBeenCalled()
    expect(socket.close).not.toHaveBeenCalled()
    const recorder = FakeRecorder.instances[0]!
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    recorder.flush()
    expect(socket.send.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(socket.send.mock.calls[1]?.[0]).toBe('{"type":"CloseStream"}')
    socket.result("Hallo Welt.", true)
    expect(callbacks.onFinal).toHaveBeenCalledWith("Hallo Welt.")
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    socket.serverClose()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(onPhase).toHaveBeenLastCalledWith("idle")
    vi.advanceTimersByTime(6000)
    expect(onError).not.toHaveBeenCalled()
  })

  it("stops a late microphone grant after cancellation without opening a socket", async () => {
    const pending = Promise.withResolvers<MediaStream>()
    const { session, callbacks } = setup(() => pending.promise)
    const starting = session.start()
    session.cancel()
    const lateStream = new MediaStream()
    pending.resolve(lateStream)
    await starting
    expect(lateStream.getTracks()[0]?.stop).toHaveBeenCalledTimes(1)
    expect(FakeSocket.instances).toHaveLength(0)
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
  })

  it("detaches callbacks and releases resources when editing cancels dictation", async () => {
    const { session, callbacks, stream } = setup()
    await session.start()
    const socket = FakeSocket.instances[0]!
    socket.open()
    session.cancel()
    session.cancel()
    socket.result("Too late", true)
    expect(callbacks.onFinal).not.toHaveBeenCalled()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(stream.getTracks()[0]?.stop).toHaveBeenCalled()
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(FakeRecorder.instances[0]?.ondataavailable).toBeNull()
  })

  it("times out finalization and frees audio and socket resources", async () => {
    const { session, callbacks, onError } = setup()
    await session.start()
    const socket = FakeSocket.instances[0]!
    socket.open()
    session.stop()
    FakeRecorder.instances[0]?.flush()
    vi.advanceTimersByTime(5000)
    expect(onError).toHaveBeenCalledWith("Final transcription timed out. Please try again.")
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it("reports abnormal closure even while waiting for the final transcript", async () => {
    const { session, callbacks, onError } = setup()
    await session.start()
    const socket = FakeSocket.instances[0]!
    socket.open()
    session.stop()
    socket.serverClose(1006)
    expect(onError).toHaveBeenCalledWith("Deepgram connection closed unexpectedly")
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
  })

  it("ignores malformed messages but forwards empty final results to clear stale previews", async () => {
    const { session, callbacks } = setup()
    await session.start()
    const socket = FakeSocket.instances[0]!
    socket.open()
    socket.onmessage?.({ data: "not json" })
    socket.onmessage?.({ data: '{"type":"Results","is_final":"false"}' })
    expect(callbacks.onInterim).not.toHaveBeenCalled()
    expect(callbacks.onFinal).not.toHaveBeenCalled()
    socket.result("", true)
    expect(callbacks.onFinal).toHaveBeenCalledWith("")
    session.cancel()
  })
})
