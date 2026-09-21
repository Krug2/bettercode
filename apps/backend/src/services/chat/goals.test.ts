import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeProviderGoal, parseGoalCommand, type ThreadGoal } from "@betterc0de/schema"
import { ThreadGoals, readGoalReport, type GoalPorts } from "./goals"

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const saved = new Map<string, ThreadGoal | null>()
  const turns: Array<{ prompt: string; settled: ReturnType<typeof deferred>; guard: () => void }> = []
  const ports: GoalPorts<{ model: string }> = {
    read: id => saved.get(id),
    publish: vi.fn((id, goal) => { saved.set(id, goal) }),
    waitForIdle: vi.fn(async () => {}),
    dispatch: vi.fn(async (_id, prompt, _context, guard, started) => {
      guard()
      const settled = deferred()
      turns.push({ prompt, settled, guard })
      started({ turnId: `turn-${turns.length}`, settled: settled.promise })
    }),
    interrupt: vi.fn(async () => true), onError: vi.fn(),
  }
  const goals = new ThreadGoals(ports)
  const start = () => goals.command("thread", { action: "set", objective: "Finish and verify the migration" }, { model: "selected" })
  const finish = async (status: string, reason = "Tests passed and all migration work is complete.") => {
    const turn = turns.at(-1)!
    const nonce = /"id":"([^"]+)"/.exec(turn.prompt)![1]
    goals.observe("thread", "content_delta", { delta: `Result\n<!-- betterc0de-goal: ${JSON.stringify({ id: nonce, status, reason })} -->` })
    turn.settled.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
  return { goals, ports, saved, turns, start, finish }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("managed goals", () => {
  it("journals before dispatch, waits for full settlement and uses the selected context on continuation", async () => {
    const f = setup()
    f.start()
    expect(f.saved.get("thread")?.status).toBe("active")
    expect(f.ports.dispatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(750)
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.turns).toHaveLength(1)
    expect(f.ports.dispatch).toHaveBeenCalledWith("thread", expect.any(String), { model: "selected" }, expect.any(Function), expect.any(Function))
    await f.finish("continue", "Migration updated; verification remains.")
    expect(f.goals.get("thread")).toMatchObject({ turns: 1, status: "active" })
    await vi.advanceTimersByTimeAsync(750)
    expect(f.turns).toHaveLength(2)
    await f.finish("complete")
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.turns).toHaveLength(2)
    expect(f.goals.get("thread")?.status).toBe("achieved")
  })

  it("pauses only its owned turn, retains the objective and resumes without duplicate turns", async () => {
    const f = setup(); f.start()
    await vi.advanceTimersByTimeAsync(750)
    f.goals.command("thread", { action: "pause" })
    expect(f.ports.interrupt).toHaveBeenCalledWith("thread", "turn-1")
    await f.finish("complete")
    expect(f.goals.get("thread")?.status).toBe("paused")
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(1)
    f.goals.command("thread", { action: "resume" })
    f.goals.command("thread", { action: "resume" })
    await vi.advanceTimersByTimeAsync(750)
    expect(f.turns).toHaveLength(2)
    await f.finish("complete")
  })

  it("does not interrupt an ordinary turn while waiting for it to settle", async () => {
    const f = setup(); const idle = deferred()
    f.ports.waitForIdle = vi.fn(() => idle.promise)
    f.start(); await vi.advanceTimersByTimeAsync(750)
    f.goals.command("thread", { action: "clear" })
    idle.resolve(); await vi.advanceTimersByTimeAsync(2000)
    expect(f.ports.dispatch).not.toHaveBeenCalled()
    expect(f.ports.interrupt).not.toHaveBeenCalled()
    expect(f.goals.get("thread")).toBeNull()
  })

  it("invalidates a completion report after editing the objective", async () => {
    const f = setup(); f.start(); await vi.advanceTimersByTimeAsync(750)
    f.goals.command("thread", { action: "edit", objective: "Also migrate the mobile client" })
    await f.finish("complete")
    expect(f.goals.get("thread")?.status).toBe("active")
    await vi.advanceTimersByTimeAsync(750)
    expect(f.turns[1].prompt).toContain("Also migrate the mobile client")
    await f.finish("complete")
  })

  it("never infers achievement from ordinary text or another turn's report", async () => {
    const f = setup(); f.start()
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(750)
      f.goals.observe("thread", "content_delta", { delta: 'All done. <!-- betterc0de-goal: {"id":"old","status":"complete","reason":"Done"} -->' })
      f.turns[i].settled.resolve(); await vi.advanceTimersByTimeAsync(0)
    }
    expect(f.goals.get("thread")).toMatchObject({ status: "blocked", turns: 3 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(3)
  })

  it("does not claim an edited objective was already achieved", async () => {
    const f = setup(); f.start(); await vi.advanceTimersByTimeAsync(750)
    await f.finish("complete")
    f.goals.command("thread", { action: "edit", objective: "A new requirement" })
    expect(f.goals.get("thread")).toMatchObject({ objective: "A new requirement", status: "paused" })
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(1)
  })

  it("blocks an uncertain dispatch or failed settlement without automatically retrying", async () => {
    const f = setup(); f.start(); await vi.advanceTimersByTimeAsync(750)
    f.turns[0].settled.reject(new Error("Remote session revoked"))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.goals.get("thread")).toMatchObject({ status: "blocked", lastReason: "Remote session revoked" })
    expect(f.turns).toHaveLength(1)
  })

  it("fails closed on a missing journal acknowledgement, including after settlement", async () => {
    const f = setup()
    vi.mocked(f.ports.publish).mockImplementationOnce(() => { throw new Error("Disk full") })
    expect(f.start).toThrow("Disk full")
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(0)
    f.start(); await vi.advanceTimersByTimeAsync(750)
    vi.mocked(f.ports.publish).mockImplementation(() => { throw new Error("Disk full") })
    await f.finish("continue")
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.turns).toHaveLength(1)
    expect(f.ports.onError).toHaveBeenCalled()
  })

  it("pauses on a manual admission and cancels a scheduled continuation", async () => {
    const f = setup(); f.start(); f.goals.pauseForMessage("thread")
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(0)
    expect(f.goals.get("thread")?.status).toBe("paused")
  })

  it("forgets deleted thread timers and does not republish a late running result", async () => {
    const f = setup(); f.start()
    f.saved.delete("thread")
    f.goals.forgetThread("thread")
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(0)
    expect(f.goals.get("thread")).toBeNull()

    f.start(); await vi.advanceTimersByTimeAsync(750)
    const published = vi.mocked(f.ports.publish).mock.calls.length
    f.saved.delete("thread")
    f.goals.forgetThread("thread")
    await f.finish("continue")
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(1)
    expect(f.ports.publish).toHaveBeenCalledTimes(published)
    expect(f.goals.get("thread")).toBeNull()
  })

  it("restores active goals as paused and shuts down without new dispatches", async () => {
    const f = setup(); const goal = f.start()!
    f.goals.dispose()
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(0)
    const restored = new ThreadGoals(f.ports)
    restored.recover("thread", goal)
    expect(restored.get("thread")?.status).toBe("paused")
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.turns).toHaveLength(0)
  })

  it("rejects budgets it cannot enforce instead of silently ignoring them", () => {
    const f = setup()
    expect(() => f.goals.command("thread", { action: "set", objective: "Task", tokenBudget: 1000 }, { model: "selected" })).toThrow("not supported")
    expect(f.ports.publish).not.toHaveBeenCalled()
  })
})

describe("goal commands and completion reports", () => {
  it("keeps native session notifications from replacing or clearing a managed goal", () => {
    const current: ThreadGoal = { source: "betterc0de", id: "owned", objective: "Task", status: "active", startedAt: Date.now(), updatedAt: Date.now() }
    expect(normalizeProviderGoal(null, current, "codex")).toBeUndefined()
    expect(normalizeProviderGoal({ objective: "Native task", status: "complete" }, current, "codex")).toBeUndefined()
    expect(normalizeProviderGoal({ source: "betterc0de", goal: null }, current)).toBeNull()
  })
  it("parses the same controls on every client", () => {
    expect(parseGoalCommand("/goal")).toEqual({ action: "status" })
    expect(parseGoalCommand("/goal continue")).toEqual({ action: "resume" })
    expect(parseGoalCommand("/goal edit New objective --budget none")).toEqual({ action: "edit", objective: "New objective", tokenBudget: null })
    expect(parseGoalCommand("/goals")).toBeNull()
    expect(() => parseGoalCommand("/goal edit")).toThrow()
    expect(() => parseGoalCommand("/goal work --budget NaN")).toThrow()
  })
  it.each([
    ["/GOAL PAUSE", { action: "pause" }],
    ["/goal Continue", { action: "resume" }],
    ["/goal RESUME", { action: "resume" }],
    ["/goal STATUS", { action: "status" }],
    ["/goal CLEAR", { action: "clear" }],
    ["/goal EDIT Fix My UI", { action: "edit", objective: "Fix My UI" }],
    ["/goal SET Pause", { action: "set", objective: "Pause" }],
    ["/goal Continue working on My UI", { action: "set", objective: "Continue working on My UI" }],
    ["/goal Fix My UI\nand verify it", { action: "set", objective: "Fix My UI\nand verify it" }],
  ])("distinguishes controls from objectives without changing their casing: %s", (text, expected) => {
    expect(parseGoalCommand(text)).toEqual(expected)
  })
  it("requires the current nonce, a valid status, evidence and a final report", () => {
    expect(readGoalReport('<!-- betterc0de-goal: {"id":"a","status":"complete","reason":"tests passed"} -->', "a")?.status).toBe("complete")
    expect(readGoalReport('<!-- betterc0de-goal: {"id":"a","status":"complete","reason":""} -->', "a")).toBeNull()
    expect(readGoalReport('<!-- betterc0de-goal: {"id":"a","status":"complete","reason":"tests passed"} -->\nActually unfinished', "a")).toBeNull()
  })
})
