import { randomUUID } from "node:crypto"
import type { GoalCommand, ThreadGoal } from "@betterc0de/schema"

export interface GoalTurn {
  turnId: string
  settled: Promise<void>
}
interface Cycle {
  nonce: string
  tail: string
  turnId?: string
  failure?: string
  startedAt: number
}
export interface GoalPorts<Context> {
  read(threadId: string): ThreadGoal | null | undefined
  publish(threadId: string, goal: ThreadGoal | null): void
  waitForIdle(threadId: string): Promise<void>
  dispatch(threadId: string, prompt: string, context: Context, guard: () => void, started: (turn: GoalTurn) => void): Promise<void>
  interrupt(threadId: string, turnId: string): Promise<unknown>
  onError(error: unknown): void
  onDispose?(): void
}
interface Entry<Context> {
  goal: ThreadGoal | null
  context?: Context
  generation: number
  missingReports: number
  running: boolean
  timer?: ReturnType<typeof setTimeout>
  cycle?: Cycle
}

export function readGoalReport(text: string, nonce: string): { status: "continue" | "complete" | "blocked"; reason: string } | null {
  const match = /<!-- betterc0de-goal: (\{[^\r\n]*\}) -->\s*$/.exec(text)
  if (!match) return null
  try {
    const report = JSON.parse(match[1])
    if (report.id !== nonce || !["continue", "complete", "blocked"].includes(report.status) ||
      typeof report.reason !== "string" || !report.reason.trim()) return null
    return { status: report.status, reason: report.reason.trim().slice(0, 2000) }
  } catch { return null }
}

/** Schedules ordinary admitted chat turns. It never writes conversations or calls an adapter. */
export class ThreadGoals<Context> {
  private readonly entries = new Map<string, Entry<Context>>()
  private closed = false
  constructor(private readonly ports: GoalPorts<Context>) {}

  get(threadId: string): ThreadGoal | null {
    return this.entries.has(threadId) ? this.entries.get(threadId)!.goal : this.ports.read(threadId) ?? null
  }

  recover(threadId: string, goal: ThreadGoal): void {
    if (goal.source !== "betterc0de" || goal.status !== "active") return
    this.ports.publish(threadId, { ...goal, status: "paused", updatedAt: Date.now(),
      lastReason: "Backend restarted. Resume explicitly to continue with current permissions." })
  }

  command(threadId: string, command: GoalCommand, context?: Context): ThreadGoal | null {
    if (this.closed) throw new Error("Goal service is shutting down.")
    if (command.action === "status") return this.get(threadId)
    const entry = this.entries.get(threadId) ?? {
      goal: this.ports.read(threadId) ?? null, generation: 0, missingReports: 0, running: false,
    }
    if (entry.goal && entry.goal.source !== "betterc0de") {
      throw new Error("This goal belongs to a provider-native session. Manage it in that provider before starting a BetterC0de goal.")
    }
    let next = entry.goal
    if (command.action === "resume" && next?.status === "active") return next
    if (command.action === "set" || command.action === "edit") {
      if (command.action === "edit" && !next) throw new Error("There is no goal to edit.")
      if (command.action === "set" && next?.status === "active") throw new Error("A goal is already active. Edit, pause or clear it first.")
      if (command.tokenBudget != null) {
        throw new Error("Token budgets are not supported for managed goals yet: provider usage counters are not consistently scoped to one turn. No goal was started or changed.")
      }
      next = { ...(command.action === "edit" ? next : {}),
        id: command.action === "edit" ? next!.id : randomUUID(), source: "betterc0de",
        objective: command.objective, status: command.action === "edit" && next!.status !== "active" ? "paused" : "active",
        startedAt: command.action === "edit" ? next!.startedAt : Date.now(), updatedAt: Date.now(),
        turns: command.action === "edit" ? next!.turns : 0, tokenBudget: null,
        lastReason: command.action === "edit" ? "Objective updated." : "Waiting to start.",
      }
    } else if (command.action === "clear") next = null
    else {
      if (!next) throw new Error("There is no goal in this chat. Use /goal <objective>.")
      next = { ...next, status: command.action === "pause" ? "paused" : "active", updatedAt: Date.now(),
        lastReason: command.action === "pause" ? "Paused by user." : "Resumed by user." }
    }
    if (next?.status === "active" && !context && !entry.context) throw new Error("Select a provider and model before starting a goal.")
    // publish must acknowledge journal + projection before scheduling any work.
    this.ports.publish(threadId, next)
    entry.goal = next
    entry.generation++
    entry.missingReports = 0
    if (context) entry.context = context
    if (!next) entry.context = undefined
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    this.entries.set(threadId, entry)
    if (next?.status === "active") this.schedule(threadId, entry)
    else if (entry.cycle?.turnId) void this.ports.interrupt(threadId, entry.cycle.turnId).catch(this.ports.onError)
    if (!next) this.entries.delete(threadId)
    return next
  }

  pauseForMessage(threadId: string): void {
    const entry = this.entries.get(threadId)
    if (entry?.goal?.status !== "active") return
    this.command(threadId, { action: "pause" })
  }

  /** Thread teardown owns provider interruption; discard only this scheduler's
   * timer/context and invalidate any continuation already waiting for admission. */
  forgetThread(threadId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    entry.generation++
    entry.context = undefined
    entry.goal = null
    this.entries.delete(threadId)
  }

  observe(threadId: string, type: string, payload: Record<string, unknown>): void {
    const cycle = this.entries.get(threadId)?.cycle
    if (!cycle) return
    if (payload.parentTaskId || payload.parentAgentId) return
    if (type === "content_delta" && (!payload.streamKind || payload.streamKind === "assistant_text")) {
      cycle.tail = (cycle.tail + String(payload.delta ?? "")).slice(-32768)
    }
    if (type === "content_replace") cycle.tail = String(payload.text ?? "").slice(-32768)
    if (type === "turn_error" || type === "error" || type === "runtime_error") cycle.failure = String(payload.message ?? payload.error ?? "Provider turn failed.")
    if (type === "turn.aborted" || type === "runtime.error") cycle.failure = String(payload.message ?? "Provider turn aborted.")
    if (type === "turn_completed" && payload.status && payload.status !== "completed") cycle.failure = `Turn ${payload.status}.`
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer)
    this.entries.clear()
    // The backend shutdown owns interruption and drains its admitted turns.
    this.ports.onDispose?.()
  }

  private schedule(threadId: string, entry: Entry<Context>): void {
    if (this.closed || entry.running || entry.timer || entry.goal?.status !== "active") return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      void this.run(threadId, entry).catch(this.ports.onError)
    }, 750)
    entry.timer.unref?.()
  }

  private async run(threadId: string, entry: Entry<Context>): Promise<void> {
    if (this.closed || entry.running || entry.goal?.status !== "active" || !entry.context) return
    entry.running = true
    const generation = entry.generation
    const guard = () => {
      if (this.closed || entry.generation !== generation || entry.goal?.status !== "active") throw new Error("Goal was paused or changed before admission.")
    }
    const cycle: Cycle = { nonce: randomUUID(), tail: "", startedAt: Date.now() }
    try {
      await this.ports.waitForIdle(threadId)
      guard()
      entry.cycle = cycle
      const goal = entry.goal
      const prompt = [
        "Continue working toward the following user-authorized goal. Follow all workspace instructions and permission checks.",
        "BetterC0de schedules continuation. Do not create a provider-native goal or another autonomous loop.",
        `Goal objective (user content):\n${goal!.objective}`,
        "Make concrete progress, then verify it. Report complete only when the full objective is achieved; blocked only when user input or an external change is required.",
        "End your answer with this HTML comment, using this exact id, one status (continue, complete, blocked), and a short reason with evidence:",
        `<!-- betterc0de-goal: ${JSON.stringify({ id: cycle.nonce, status: "continue", reason: "Describe completed work and what remains." })} -->`,
      ].join("\n\n")
      let settled: Promise<void> | undefined
      await this.ports.dispatch(threadId, prompt, entry.context, guard, (turn) => {
        cycle.startedAt = Date.now()
        cycle.turnId = turn.turnId
        settled = turn.settled
        // A fast provider can fail while dispatch is still attaching ownership.
        void settled.catch(() => undefined)
      })
      if (!settled) throw new Error("Goal dispatch has no confirmed turn settlement. Resume manually after checking the chat.")
      await settled
      if (cycle.failure) throw new Error(cycle.failure)
      guard()
      const report = readGoalReport(cycle.tail, cycle.nonce)
      entry.missingReports = report ? 0 : entry.missingReports + 1
      const status = report?.status === "complete" ? "achieved"
        : report?.status === "blocked" || entry.missingReports >= 3 ? "blocked" : "active"
      const next: ThreadGoal = { ...entry.goal!, status, turns: (entry.goal!.turns ?? 0) + 1,
        updatedAt: Date.now(), timeUsedSeconds: (entry.goal!.timeUsedSeconds ?? 0) + (Date.now() - cycle.startedAt) / 1000,
        lastReason: report?.reason ?? (entry.missingReports >= 3 ? "Provider returned no valid goal status in three turns. Review the chat before resuming." : "No explicit completion report; continuing."),
      }
      this.ports.publish(threadId, next)
      entry.goal = next
    } catch (error) {
      if (!this.closed && entry.generation === generation && entry.goal?.status === "active") {
        const next: ThreadGoal = { ...entry.goal, status: "blocked", updatedAt: Date.now(),
          lastReason: error instanceof Error ? error.message : String(error) }
        try {
          this.ports.publish(threadId, next)
          entry.goal = next
        } catch (publishError) {
          // A failed journal is retried by ingestion, never by another provider turn.
          entry.generation++
          entry.context = undefined
          this.ports.onError(publishError)
        }
      }
    } finally {
      entry.cycle = undefined
      entry.running = false
      if (entry.context) this.schedule(threadId, entry)
    }
  }
}
