import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
vi.mock("../ChildProcessTermination", () => ({ terminateProviderChildProcessTree: mocks.terminate }))
vi.mock("./GrokBinaryResolution", () => ({
  resolveGrokBinaryAsync: async (binaryPath: string) => ({ binaryPath, source: "config" }),
}))

function child() {
  const process = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  })
  return process as unknown as ChildProcess
}

let home: string
beforeEach(() => {
  vi.resetModules()
  mocks.spawn.mockReset()
  mocks.terminate.mockReset().mockResolvedValue(undefined)
  home = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-grok-status-"))
  vi.spyOn(os, "homedir").mockReturnValue(home)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
})

const input = (binaryPath: string) => ({ binaryPath, env: { XAI_API_KEY: "configured" } })

describe("Grok optional status metadata", () => {
  it("does not assign an in-flight binary's version to another instance", async () => {
    const process = child()
    mocks.spawn.mockReturnValue(process)
    const { probeGrokProviderStatusAsync } = await import("./GrokProviderStatus")
    const first = probeGrokProviderStatusAsync(input("one.exe"))
    const second = probeGrokProviderStatusAsync(input("two.exe"))
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    process.stdout?.emit("data", "grok 1.2.3")
    process.emit("close", 0)
    expect((await first).version).toBe("1.2.3")
    expect((await second).version).toBeNull()
  })

  it("waits for timeout cleanup even when the root closes during termination", async () => {
    vi.useFakeTimers()
    const process = child()
    mocks.spawn.mockReturnValue(process)
    let cleanupDone!: () => void
    mocks.terminate.mockReturnValue(new Promise<void>((resolve) => { cleanupDone = resolve }))
    const { probeGrokProviderStatusAsync } = await import("./GrokProviderStatus")
    let settled = false
    const probe = probeGrokProviderStatusAsync(input("timeout.exe")).then((result) => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3_000)
    process.emit("close", 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.terminate).toHaveBeenCalledWith(process)
    expect(settled).toBe(false)
    cleanupDone()
    expect((await probe).version).toBeNull()
    expect(mocks.spawn.mock.calls[0]?.[2]).toMatchObject({ detached: globalThis.process.platform !== "win32" })
  })

  it("retains failed cleanup and retries it before admitting another child", async () => {
    vi.useFakeTimers()
    const process = child()
    mocks.spawn.mockReturnValue(process)
    mocks.terminate.mockRejectedValue(new Error("tree survived"))
    const { probeGrokProviderStatusAsync } = await import("./GrokProviderStatus")
    const first = probeGrokProviderStatusAsync(input("retained.exe"))
    await vi.advanceTimersByTimeAsync(3_000)
    expect((await first).version).toBeNull()
    expect((await probeGrokProviderStatusAsync(input("retry.exe"))).version).toBeNull()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.terminate).toHaveBeenCalledTimes(2)
    mocks.terminate.mockResolvedValue(undefined)
    const recovered = probeGrokProviderStatusAsync(input("recovered.exe"))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    process.stdout?.emit("data", "grok 2.0.0")
    process.emit("close", 0)
    expect((await recovered).version).toBe("2.0.0")
  })

  it("bounds both synchronous and asynchronous config reads", async () => {
    fs.mkdirSync(path.join(home, ".grok"))
    fs.writeFileSync(path.join(home, ".grok", "config.toml"), 'api_key="present"\n' + " ".repeat(1024 * 1024))
    const { detectGrokAuth, detectGrokAuthAsync } = await import("./GrokProviderStatus")
    expect(detectGrokAuth({})).toEqual({ status: "unknown" })
    await expect(detectGrokAuthAsync({})).resolves.toEqual({ status: "unknown" })
  })

  it.skipIf(globalThis.process.platform !== "win32")("keeps an unconfirmed Windows tree fenced after its root exits", async () => {
    vi.useFakeTimers()
    const process = child()
    mocks.spawn.mockReturnValue(process)
    mocks.terminate.mockRejectedValue(new Error("tree unconfirmed"))
    const { probeGrokProviderStatusAsync } = await import("./GrokProviderStatus")
    const first = probeGrokProviderStatusAsync(input("survivor.exe"))
    await vi.advanceTimersByTimeAsync(3_000)
    await first
    Object.defineProperty(process, "exitCode", { value: 1 })
    mocks.terminate.mockResolvedValue(undefined)
    expect((await probeGrokProviderStatusAsync(input("later.exe"))).version).toBeNull()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.terminate).toHaveBeenCalledOnce()
  })
})
