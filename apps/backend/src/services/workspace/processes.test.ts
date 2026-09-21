import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  __runBoundedWorkspaceCommandForTests,
  beginWorkspaceProcessShutdown,
  resumeWorkspaceProcessAdmissions,
  runBoundedWorkspaceCommand,
  shutdownAllWorkspaceProcesses,
} from "./processes"

afterEach(() => {
  resumeWorkspaceProcessAdmissions()
})

describe("runBoundedWorkspaceCommand failure kinds", () => {
  it.each(["shutdown", "aborted"] as const)(
    "does not spawn after %s during asynchronous validation",
    async (kind) => {
      const controller = new AbortController()
      let enterValidation!: () => void
      let releaseValidation!: () => void
      const entered = new Promise<void>((resolve) => {
        enterValidation = resolve
      })
      const released = new Promise<void>((resolve) => {
        releaseValidation = resolve
      })
      const pending = runBoundedWorkspaceCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write('unexpected-spawn')"],
        env: process.env,
        timeoutMs: 10_000,
        outputLimitBytes: 1_024,
        label: "deferred-validation-test",
        signal: controller.signal,
        beforeSpawn: async () => {
          enterValidation()
          await released
        },
      })
      await entered
      if (kind === "shutdown") await shutdownAllWorkspaceProcesses()
      else controller.abort()
      releaseValidation()
      const result = await pending
      expect(result.stdout).toBe("")
      expect(result.exitCode).toBeNull()
      expect(result.failure).toEqual({ kind })
    }
  )

  it("types an already-aborted request instead of only writing stderr", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await __runBoundedWorkspaceCommandForTests({
      command: "node",
      args: ["-e", "0"],
      signal: controller.signal,
    })
    expect(result.exitCode).toBeNull()
    expect(result.failure).toEqual({ kind: "aborted" })
  })

  it("types shutdown refusals", async () => {
    beginWorkspaceProcessShutdown()
    const result = await __runBoundedWorkspaceCommandForTests({
      command: "node",
      args: ["-e", "0"],
    })
    expect(result.exitCode).toBeNull()
    expect(result.failure).toEqual({ kind: "shutdown" })
  })

  it("types a binary that cannot be spawned", async () => {
    const missing = path.join(
      process.cwd(),
      "definitely-missing-betterc0de-binary-" + process.pid
    )
    const result = await __runBoundedWorkspaceCommandForTests({
      command: missing,
      args: [],
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBeNull()
    expect(result.failure).toEqual({ kind: "spawn-error" })
  })

  it("leaves failure absent for a real exit", async () => {
    const result = await __runBoundedWorkspaceCommandForTests({
      command: "node",
      args: ["-e", "process.exit(3)"],
      timeoutMs: 20_000,
    })
    expect(result.exitCode).toBe(3)
    expect(result.failure).toBeUndefined()
  }, 30_000)
})
