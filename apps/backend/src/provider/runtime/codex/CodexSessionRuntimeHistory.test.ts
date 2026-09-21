import { beforeEach, describe, expect, it, vi } from "vitest"

const rpcState = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown }>,
}))

vi.mock("./rpc", () => ({
  CodexRpcClient: class {
    async spawnChild(): Promise<void> {}
    async call(method: string, params: unknown): Promise<unknown> {
      rpcState.calls.push({ method, params })
      if (method === "thread/start") return { thread: { id: "fresh-thread" } }
      return {}
    }
    notify(): void {}
    isAlive(): boolean {
      return true
    }
    setServerRequestHandler(): void {}
    onNotification(): void {}
    onStderr(): void {}
    on(): void {}
    async close(): Promise<void> {}
  },
}))

import { CodexSessionRuntime } from "./CodexSessionRuntime"

const clientInfo = { name: "test", title: "Test", version: "0.0.0" }

describe("CodexSessionRuntime history seeding", () => {
  beforeEach(() => {
    rpcState.calls.length = 0
  })

  it("requests one history seed for a fresh thread and again after full rollback", async () => {
    const runtime = new CodexSessionRuntime({ binaryPath: "ignored" })
    await runtime.start({ clientInfo })

    expect(runtime.requiresHistorySeed()).toBe(true)
    await runtime.sendTurn({ message: "first" })
    expect(runtime.requiresHistorySeed()).toBe(false)
    await runtime.rollbackThread(1)
    expect(runtime.requiresHistorySeed()).toBe(true)
  })

  it("never seeds local history over a successfully resumed native thread", async () => {
    const runtime = new CodexSessionRuntime({ binaryPath: "ignored" })
    await runtime.start({
      clientInfo,
      storedProviderThreadId: "existing-thread",
    })

    expect(runtime.requiresHistorySeed()).toBe(false)
    expect(rpcState.calls).toContainEqual({
      method: "thread/resume",
      params: expect.objectContaining({ threadId: "existing-thread" }),
    })
  })
})
