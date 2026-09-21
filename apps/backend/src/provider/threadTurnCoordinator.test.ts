import { describe, expect, it } from "vitest"
import { ThreadTurnCoordinator } from "./threadTurnCoordinator"

describe("ThreadTurnCoordinator", () => {
  it("waits through pre-dispatch reservations and ignores a release by another owner", async () => {
    const coordinator = new ThreadTurnCoordinator()
    const token = coordinator.reserveTurn("thread", "compaction")!
    let idle = false
    const waiting = coordinator.waitForIdle("thread").then(() => { idle = true })
    coordinator.releaseTurn("thread", Symbol("wrong owner"))
    await Promise.resolve()
    expect(idle).toBe(false)
    coordinator.releaseTurn("thread", token)
    await waiting
    expect(idle).toBe(true)
  })

  it("does not resume queued work until teardown has also left maintenance", async () => {
    const coordinator = new ThreadTurnCoordinator()
    const token = coordinator.reserveTurn("thread", "provider")!
    let idle = false
    let waiting!: Promise<void>
    await coordinator.withTeardown("thread", async () => {
      waiting = coordinator.waitForIdle("thread").then(() => { idle = true })
      coordinator.releaseTurn("thread", token)
      await Promise.resolve()
      expect(idle).toBe(false)
    })
    await waiting
    expect(idle).toBe(true)
  })

  it("admits only one provider stack per thread", () => {
    const coordinator = new ThreadTurnCoordinator()
    const legacy = coordinator.reserveTurn("thread-1", "legacy:openai")

    expect(legacy).toEqual(expect.any(Symbol))
    expect(coordinator.reserveTurn("thread-1", "hub:codex")).toBeNull()
    coordinator.releaseTurn("thread-1", legacy!)
    expect(coordinator.reserveTurn("thread-1", "hub:codex")).toEqual(
      expect.any(Symbol)
    )
  })

  it("blocks new turns throughout teardown while allowing active release", async () => {
    const coordinator = new ThreadTurnCoordinator()
    const active = coordinator.reserveTurn("thread-1", "hub:codex")!

    await coordinator.withTeardown("thread-1", async () => {
      expect(coordinator.reserveTurn("thread-1", "legacy:openai")).toBeNull()
      coordinator.releaseTurn("thread-1", active)
      expect(coordinator.reserveTurn("thread-1", "legacy:openai")).toBeNull()
    })

    expect(coordinator.reserveTurn("thread-1", "legacy:openai")).toEqual(
      expect.any(Symbol)
    )
  })
})
