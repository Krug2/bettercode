import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClaudeAdapter } from "./ClaudeAdapter"

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn(), query: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
vi.mock("../ChildProcessTermination", () => ({ terminateProviderChildProcessTree: mocks.terminate }))
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mocks.query }))

describe("Claude metadata resource retention", () => {
  beforeEach(() => { vi.resetAllMocks() })
  afterEach(() => { vi.useRealTimers() })

  it("retries an unconfirmed command child and prevents another spawn", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345 })
    const failure = new Error("process cleanup unconfirmed")
    mocks.terminate.mockRejectedValue(failure)
    mocks.spawn.mockImplementation(() => {
      setImmediate(() => child.stdout.emit("data", Buffer.alloc(300_000)))
      return child
    })
    const adapter = new ClaudeAdapter({ binaryPath: process.execPath })
    await expect(adapter.probeStatus()).resolves.toMatchObject({ status: "error" })
    await expect(adapter.probeStatus()).rejects.toBe(failure)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await expect(adapter.stopAll()).rejects.toThrow("Failed to stop all Claude")
    mocks.terminate.mockResolvedValue(undefined)
    await expect(adapter.stopAll()).resolves.toBeUndefined()
    expect(mocks.terminate).toHaveBeenCalledTimes(4)
    expect(mocks.terminate.mock.calls.every(([target]) => target === child)).toBe(true)
    child.stdout.destroy()
    child.stderr.destroy()
  })

  it("bounds a hanging SDK close, retains it, and does not duplicate cleanup", async () => {
    vi.useFakeTimers()
    let release!: () => void
    const closing = new Promise<void>((resolve) => { release = resolve })
    const close = vi.fn(() => closing)
    mocks.query.mockReturnValue({ initializationResult: async () => ({ commands: [] }), close })
    const adapter = new ClaudeAdapter({ binaryPath: process.execPath })
    const probe = adapter.availableSlashCommands()
    const rejectedProbe = expect(probe).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(8_001)
    await rejectedProbe
    const stop = adapter.stopAll()
    const rejectedStop = expect(stop).rejects.toThrow("Failed to stop all Claude")
    await vi.advanceTimersByTimeAsync(8_001)
    await rejectedStop
    expect(close).toHaveBeenCalledOnce()
    release()
    await closing
    await adapter.stopAll()
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.query).toHaveBeenCalledOnce()
  })

  it.skipIf(process.platform !== "win32")("retains failed cleanup after the Windows root exits", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345,
      exitCode: null as number | null, signalCode: null,
    })
    mocks.terminate.mockRejectedValue(new Error("process cleanup unconfirmed"))
    mocks.spawn.mockImplementation(() => {
      setImmediate(() => child.stdout.emit("data", Buffer.alloc(300_000)))
      return child
    })
    const adapter = new ClaudeAdapter({ binaryPath: process.execPath })
    await expect(adapter.probeStatus()).resolves.toMatchObject({ status: "error" })
    child.exitCode = 0
    mocks.terminate.mockResolvedValue(undefined)
    await expect(adapter.probeStatus()).rejects.toThrow("descendant cleanup remains unconfirmed")
    await expect(adapter.stopAll()).rejects.toThrow("Failed to stop all Claude")
    expect(mocks.terminate).toHaveBeenCalledOnce()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    child.stdout.destroy()
    child.stderr.destroy()
  })
})
