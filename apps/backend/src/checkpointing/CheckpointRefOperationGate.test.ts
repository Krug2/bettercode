import { describe, expect, it } from "vitest"
import { CheckpointRefOperationGate } from "./CheckpointRefOperationGate"

describe("CheckpointRefOperationGate", () => {
  it("serializes capture and cleanup of the same deterministic ref", async () => {
    const gate = new CheckpointRefOperationGate()
    const trace: string[] = []
    let releaseCapture!: () => void
    const captureBlocked = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })

    const capture = gate.withRef("/repo", "refs/checkpoint/turn/0", async () => {
      trace.push("capture:start")
      await captureBlocked
      trace.push("capture:end")
    })
    await Promise.resolve()
    const cleanup = gate.withRef(
      "/repo-linked-worktree",
      "refs/checkpoint/turn/0",
      async () => {
        trace.push("cleanup")
      }
    )
    await Promise.resolve()

    expect(trace).toEqual(["capture:start"])
    releaseCapture()
    await Promise.all([capture, cleanup])
    expect(trace).toEqual(["capture:start", "capture:end", "cleanup"])
  })

  it("allows unrelated refs to progress concurrently", async () => {
    const gate = new CheckpointRefOperationGate()
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let secondRan = false

    const first = gate.withRef("/repo", "refs/checkpoint/turn/0", () =>
      firstBlocked
    )
    const second = gate.withRef(
      "/repo",
      "refs/checkpoint/turn/1",
      () => {
        secondRan = true
      }
    )
    await second

    expect(secondRan).toBe(true)
    releaseFirst()
    await first
  })
})
