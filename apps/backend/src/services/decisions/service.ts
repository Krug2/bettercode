import { randomUUID } from "node:crypto"
import {
  decisionSnapshotSchema, emptyDecisionSnapshot,
  type DecisionCandidate, type DecisionRecord, type DecisionSettings, type DecisionSnapshot,
} from "@betterc0de/schema"
import { JEV_MODEL } from "../code-search/contracts"
import { ABSTAIN, selectCandidate, SelectionFailure } from "./client"

interface Dependencies {
  settings(): { decision_layer: DecisionSettings; jev_api_key?: string }
  load(threadId: string): unknown
  publish(snapshot: DecisionSnapshot): void
  select?: typeof selectCandidate
}
interface TurnBudget { calls: number; controller: AbortController }

export class DecisionService {
  private readonly turns = new Map<string, TurnBudget>()
  private readonly snapshots = new Map<string, DecisionSnapshot>()
  private readonly pending = new Set<AbortController>()
  private closed = false

  constructor(private readonly deps: Dependencies) {}

  enabled(): boolean { return !this.closed && this.deps.settings().decision_layer.mode !== "off" }

  beginTurn(threadId: string): void {
    this.turns.get(threadId)?.controller.abort()
    this.turns.delete(threadId)
    this.turns.set(threadId, { calls: 0, controller: new AbortController() })
    if (this.turns.size > 128) {
      const oldest = this.turns.keys().next().value!
      this.turns.get(oldest)?.controller.abort()
      this.turns.delete(oldest)
    }
  }

  cancel(threadId: string): void { this.turns.get(threadId)?.controller.abort() }

  settingsChanged(): void {
    for (const controller of this.pending) controller.abort()
  }

  close(): void {
    this.closed = true
    this.settingsChanged()
    for (const turn of this.turns.values()) turn.controller.abort()
  }

  snapshot(threadId: string): DecisionSnapshot {
    let snapshot = this.snapshots.get(threadId)
    if (!snapshot) {
      const parsed = decisionSnapshotSchema.safeParse(this.deps.load(threadId))
      snapshot = parsed.success && parsed.data.threadId === threadId ? parsed.data : emptyDecisionSnapshot(threadId)
      let recovered = false
      for (const record of snapshot.records) {
        if (record.status !== "deciding") continue
        record.status = "cancelled"
        record.reason = "interrupted by restart"
        snapshot.fallbacks++
        snapshot.unreported++
        recovered = true
      }
      this.snapshots.set(threadId, snapshot)
      if (this.snapshots.size > 128) this.snapshots.delete(this.snapshots.keys().next().value!)
      if (recovered) this.publish(snapshot)
    }
    return structuredClone(snapshot)
  }

  async choose(input: {
    threadId: string
    kind: DecisionRecord["kind"]
    task: string
    candidates: readonly (DecisionCandidate & { description: string })[]
    valid(): boolean
    signal?: AbortSignal
  }): Promise<string | null> {
    if (!this.enabled()) return null
    const settings = this.deps.settings()
    const config = settings.decision_layer
    if (!this.turns.has(input.threadId)) this.beginTurn(input.threadId)
    const turn = this.turns.get(input.threadId)!
    this.snapshot(input.threadId)
    const snapshot = this.snapshots.get(input.threadId)!
    const record: DecisionRecord = {
      id: randomUUID(), threadId: input.threadId, kind: input.kind, status: "deciding",
      mode: config.mode, model: config.mode === "jev" ? JEV_MODEL : config.localModel,
      candidates: input.candidates.slice(0, 128).map(({ id, label }) => ({ id, label })),
      choice: null, confidence: null, reason: null, elapsedMs: 0,
      inputTokens: null, outputTokens: null, createdAt: new Date().toISOString(),
    }
    const fallback = !input.candidates.length ? "no eligible candidates"
      : input.candidates.length > 128 || input.candidates.some(candidate => candidate.id === ABSTAIN) ? "invalid candidate pool"
      : turn.controller.signal.aborted || input.signal?.aborted ? "cancelled"
      : turn.calls >= config.maxCallsPerTurn ? "decision budget reached"
      : this.pending.size >= 4 ? "selector busy"
      : config.mode === "jev" && !settings.jev_api_key ? "key not configured"
      : config.mode === "local" && !config.localModel ? "local model not configured"
      : null
    snapshot.records = [...snapshot.records, record].slice(-64)
    if (fallback) {
      record.status = fallback === "cancelled" ? "cancelled" : "fallback"
      record.reason = fallback
      snapshot.fallbacks++
      this.publish(snapshot)
      return null
    }
    turn.calls++
    snapshot.calls++
    this.publish(snapshot)
    const controller = new AbortController()
    this.pending.add(controller)
    const signal = AbortSignal.any([controller.signal, turn.controller.signal, ...(input.signal ? [input.signal] : [])])
    const started = performance.now()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    let abort: () => void = () => undefined
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new SelectionFailure("request cancelled or timed out"))
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) abort()
      })
      const result = await Promise.race([
        (this.deps.select ?? selectCandidate)({ settings: config, apiKey: settings.jev_api_key,
          task: input.task.slice(0, 12000), candidates: input.candidates, signal }),
        cancelled,
      ])
      record.inputTokens = result.inputTokens
      record.outputTokens = result.outputTokens
      record.confidence = result.confidence
      record.model = result.model
      if (signal.aborted || this.turns.get(input.threadId) !== turn ||
          JSON.stringify(this.deps.settings().decision_layer) !== JSON.stringify(config) || !input.valid())
        throw new SelectionFailure("state changed", { inputTokens: result.inputTokens, outputTokens: result.outputTokens })
      if (result.choice === ABSTAIN) record.reason = "selector abstained"
      else if (!input.candidates.some(candidate => candidate.id === result.choice)) record.reason = "unknown candidate"
      else if (result.confidence !== null && result.confidence < config.minConfidence) record.reason = "low confidence"
      else record.choice = result.choice
      record.status = record.choice ? "selected" : "fallback"
    } catch (error) {
      record.status = turn.controller.signal.aborted || input.signal?.aborted || this.closed ? "cancelled" : "fallback"
      record.reason = error instanceof SelectionFailure ? error.reason : "selection failed"
      if (error instanceof SelectionFailure) Object.assign(record, error.usage)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      this.pending.delete(controller)
      record.elapsedMs = Math.round(performance.now() - started)
      snapshot.elapsedMs += record.elapsedMs
      snapshot.inputTokens += record.inputTokens ?? 0
      snapshot.outputTokens += record.outputTokens ?? 0
      if (record.inputTokens === null || record.outputTokens === null) snapshot.unreported++
      if (record.status === "selected") snapshot.selected++
      else snapshot.fallbacks++
      this.publish(snapshot)
    }
    return record.choice
  }

  private publish(snapshot: DecisionSnapshot): void {
    snapshot.revision++
    this.deps.publish(structuredClone(snapshot))
  }
}
