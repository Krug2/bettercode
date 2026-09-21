import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ThreadId } from "../contracts"

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
vi.mock("../ChildProcessTermination", () => ({ terminateProviderChildProcessTree: mocks.terminate }))
afterEach(() => vi.restoreAllMocks())

describe("Compatibility process cleanup ownership", () => {
  it("drains a status probe across its version command and later server connection", async () => {
    vi.resetModules()
    mocks.spawn.mockReset()
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, pid: 12345,
    })
    mocks.spawn.mockReturnValue(child)
    const { BetterC0deCompatAdapter } = await import("./BetterC0deCompatAdapter")
    const close = vi.fn(async () => {})
    const serverConnector = vi.fn(async () => ({ url: "http://127.0.0.1:4096", external: false, close }))
    const adapter = new BetterC0deCompatAdapter({
      binaryPath: path.resolve("fake-compat.exe"), serverConnector,
      clientFactory: async () => { throw new Error("fixture inventory unavailable") },
    })
    const probing = adapter.probeStatus()
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    let stopped = false
    const stopping = adapter.stopAll().then(() => { stopped = true })
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(stopped).toBe(false)
      await expect(adapter.probeStatus()).rejects.toThrow(/shutdown/i)
    } finally {
      child.stdout.write("1.14.19\n")
      child.emit("close", 0)
      await probing
      await stopping
      child.stdout.destroy()
      child.stderr.destroy()
    }
    expect(serverConnector).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it("filters unsafe environment overrides at the final native spawn boundary", async () => {
    vi.resetModules()
    mocks.spawn.mockReset().mockReturnValue({})
    const { spawnBetterC0deBinary } = await import("./BetterC0deCompatAdapter")
    spawnBetterC0deBinary(path.resolve("fake-compat.exe"), ["--version"], {
      env: { NODE_OPTIONS: "--require injected.js", BETTERC0DE_SETTINGS_KEY: "private", XAI_API_KEY: "explicit-provider-key" },
    })
    const options = mocks.spawn.mock.calls[0]?.[2]
    expect(options.env.NODE_OPTIONS).toBeUndefined()
    expect(options.env.BETTERC0DE_SETTINGS_KEY).toBeUndefined()
    expect(options.env.XAI_API_KEY).toBe("explicit-provider-key")
  })

  it.each(["version", "startup"])("retains failed %s cleanup until shutdown confirms the same child", async (phase) => {
    vi.resetModules()
    mocks.spawn.mockReset()
    mocks.terminate.mockReset().mockRejectedValue(new Error("tree survived"))
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, pid: 12345,
    })
    mocks.spawn.mockReturnValue(child)
    const { BetterC0deCompatAdapter } = await import("./BetterC0deCompatAdapter")
    const adapter = new BetterC0deCompatAdapter({ binaryPath: path.resolve("fake-compat.exe") })
    const first = phase === "version"
      ? adapter.probeStatus()
      : adapter.startSession({ threadId: "failing-start" as ThreadId }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    const stopped = phase === "startup"
      ? adapter.stopSession("failing-start" as ThreadId).then(() => null, (error: unknown) => error)
      : null
    child.stdout.write(Buffer.alloc(300 * 1024, 120))
    await first
    if (stopped) expect(await stopped).toBeInstanceOf(AggregateError)
    const next = adapter.probeStatus()
    // A new probe must retry the owned child, without spawning another one.
    await vi.waitFor(() => expect(mocks.terminate.mock.calls.length + mocks.spawn.mock.calls.length).toBeGreaterThanOrEqual(3))
    if (mocks.spawn.mock.calls.length > 1) child.stdout.write(Buffer.alloc(300 * 1024, 120))
    await next
    expect(mocks.spawn).toHaveBeenCalledOnce()
    mocks.terminate.mockResolvedValue(undefined)
    await adapter.stopAll()
    expect(mocks.terminate).toHaveBeenLastCalledWith(child)
    expect(mocks.terminate).toHaveBeenCalledTimes(3)
    child.stdout.destroy()
    child.stderr.destroy()
  })
})
