import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { asRecord } from "@betterc0de/schema"
import type { ThreadSaveMessage } from "../../services/threads/types"
import type { ThreadActivityProjection } from "../../persistence/projections"
import { ProviderRuntimeIngestion, providerAssistantMessageId } from "./ProviderRuntimeIngestion"
import { canonicalJournalEntry, legacyJournalEntry } from "./journalEntry"
import type { ProviderRuntimeEvent as CanonicalProviderRuntimeEvent } from "./contracts"

const ingestions: ProviderRuntimeIngestion[] = []
afterEach(() => {
  for (const ingestion of ingestions.splice(0)) ingestion.stop()
  vi.useRealTimers()
})

function fixture(persist = true) {
  const messages = new Map<string, ThreadSaveMessage>()
  const activities: ThreadActivityProjection[] = []
  const upsertMessage = vi.fn((input: { thread_id: string; message: ThreadSaveMessage }) => {
    messages.set(input.message.message_id, structuredClone(input.message))
  })
  const broadcast = vi.fn()
  const markProjected = vi.fn()
  const markFailedByProviderTurn = vi.fn()
  const markCompletedByProviderTurn = vi.fn()
  const updateSessionLifecycle = vi.fn()
  let journalSequence = 0
  const upsertActivity = vi.fn((activity: ThreadActivityProjection) => activities.push(activity))
  const ingestion = new ProviderRuntimeIngestion({
    eventBus: new EventEmitter(), sequenceStart: 0,
    activityStore: { upsert: upsertActivity },
    transcriptStore: { upsertMessage, getMessage: (_thread, id) => messages.get(id) ?? null },
    broadcaster: { broadcast, clientCount: () => 1 },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventJournal: { persist: () => ++journalSequence },
    projectionReceipts: { markProjected },
    sessionLifecycleStore: { updateSessionLifecycle },
    shouldPersistConversations: () => persist,
    chatDispatchLifecycleStore: {
      hasProviderTurn: () => true, markCompletedByProviderTurn, markFailedByProviderTurn,
    },
  })
  ingestions.push(ingestion)
  const event = (thread: string, turn: string, event_type: string, payload: Record<string, unknown> = {}) => ({
    event_type, thread_id: thread, payload: { turn_id: turn, ...payload },
  })
  const emit = (thread: string, turn: string, type: string, payload: Record<string, unknown> = {}) =>
    ingestion.ingest(event(thread, turn, type, payload))
  const replay = (sequence: number, type: string, payload: Record<string, unknown> = {}) =>
    ingestion.replayPersisted(legacyJournalEntry(event("thread", "turn", type, payload)), { projectionSequence: sequence })
  return { ingestion, messages, activities, upsertMessage, broadcast, markProjected, upsertActivity, markFailedByProviderTurn, markCompletedByProviderTurn, updateSessionLifecycle, emit, replay }
}

describe("provider ingestion boundaries", () => {
  it("keeps delimiter-containing thread and turn pairs isolated", () => {
    const f = fixture()
    f.emit("a:b", "c", "content_delta", { delta: "first" })
    f.emit("a", "b:c", "content_delta", { delta: "second" })
    f.emit("a:b", "c", "turn_completed")
    f.emit("a", "b:c", "turn_completed")
    expect(f.messages.get(providerAssistantMessageId("a:b", "c"))?.content).toBe("first")
    expect(f.messages.get(providerAssistantMessageId("a", "b:c"))?.content).toBe("second")
  })

  it("does not flush a longer thread ID when its prefix thread exits", () => {
    const f = fixture()
    f.emit("a:b", "turn", "content_delta", { delta: "still running" })
    f.emit("a", "other", "session.exited")
    expect(f.upsertMessage).not.toHaveBeenCalled()
    f.emit("a:b", "turn", "content_delta", { delta: " tail" })
    f.emit("a:b", "turn", "turn_completed")
    expect(f.messages.get(providerAssistantMessageId("a:b", "turn"))?.content).toBe("still running tail")
  })

  it("keeps proposed plans isolated across ambiguous thread and turn pairs", () => {
    const f = fixture()
    f.emit("a:b", "c", "turn.proposed.delta", { delta: "first plan" })
    f.emit("a", "b:c", "turn.proposed.delta", { delta: "second plan" })
    f.emit("a:b", "c", "turn.proposed.completed")
    f.emit("a", "b:c", "turn.proposed.completed")
    expect(f.activities.filter(a => a.kind === "turn.proposed.completed").map(a => [a.thread_id, asRecord(a.payload).planMarkdown]))
      .toEqual([["a:b", "first plan"], ["a", "second plan"]])
  })

  it("persists an empty replacement of a previously saved assistant message", () => {
    vi.useFakeTimers()
    const f = fixture()
    f.emit("thread", "turn", "content_delta", { delta: "discarded answer" })
    vi.advanceTimersByTime(250)
    expect(f.messages.get(providerAssistantMessageId("thread", "turn"))?.content).toBe("discarded answer")
    f.emit("thread", "turn", "content_replace", { text: "" })
    f.emit("thread", "turn", "turn_completed")
    expect(f.messages.get(providerAssistantMessageId("thread", "turn"))).toMatchObject({
      content: "", extra: { providerRuntimeSequence: 3, status: "completed" },
    })
  })

  it("recovers already-journaled transcripts when new conversation auto-save is disabled", () => {
    const f = fixture(false)
    f.replay(1, "content_delta", { delta: "durable journal text" })
    expect(f.messages.get(providerAssistantMessageId("thread", "turn"))?.content).toBe("durable journal text")
    expect(f.broadcast).not.toHaveBeenCalled()
    f.emit("ephemeral", "turn", "content_delta", { delta: "must stay ephemeral" })
    f.emit("ephemeral", "turn", "turn_completed")
    expect(f.messages.has(providerAssistantMessageId("ephemeral", "turn"))).toBe(false)
  })

  it("replays a synthetic proposed-plan completion silently", () => {
    const f = fixture()
    f.replay(1, "turn.proposed.delta", { delta: "recovered plan" })
    f.replay(2, "turn_completed")
    expect(f.activities.some(a => a.kind === "turn.proposed.completed")).toBe(true)
    expect(f.broadcast).not.toHaveBeenCalled()
  })

  it("leaves the journal unreceipted when synthetic plan persistence fails", () => {
    const f = fixture()
    f.emit("thread", "turn", "turn.proposed.delta", { delta: "recoverable plan" })
    f.markProjected.mockClear()
    f.upsertActivity.mockImplementation(activity => {
      if (activity.kind === "turn.proposed.completed") throw new Error("plan storage unavailable")
      f.activities.push(activity)
      return f.activities.length
    })
    f.emit("thread", "turn", "turn_completed")
    expect(f.markProjected).not.toHaveBeenCalled()
  })

  it("does not fail the whole dispatch when an individual tool reports failure", () => {
    const f = fixture()
    f.emit("thread", "turn", "tool_result", { tool_id: "tool", status: "failed", error: "tool failed" })
    expect(f.markFailedByProviderTurn).not.toHaveBeenCalled()
    f.emit("thread", "turn", "turn_completed", { status: "failed" })
    expect(f.markFailedByProviderTurn).toHaveBeenCalledOnce()
  })

  it.each(["live", "replay"] as const)("projects a timed-out canonical completion as a session error during %s", (mode) => {
    const f = fixture()
    f.emit("thread", "turn", "content_delta", { delta: "partial answer" })
    const timeout: CanonicalProviderRuntimeEvent = {
      type: "turn.completed", eventId: "timeout", at: 1_000,
      threadId: "thread", turnId: "turn", providerKind: "codex", providerInstanceId: "codex-work",
      payload: { state: "timed_out", dispatchTurnId: "dispatch" },
    }
    f.broadcast.mockClear()
    if (mode === "live") f.ingestion.ingestCanonical(timeout)
    else f.ingestion.replayPersisted(canonicalJournalEntry(timeout), { projectionSequence: 2 })

    expect(f.updateSessionLifecycle).toHaveBeenLastCalledWith({
      threadId: "thread", providerKind: "codex", providerInstanceId: "codex-work",
      status: "error", activeTurnId: null, lastError: "Provider turn failed.",
    })
    expect(f.markFailedByProviderTurn).toHaveBeenCalledWith(
      "thread", "codex-work", "dispatch", "Provider turn ended with status 'timed_out'."
    )
    expect(f.markCompletedByProviderTurn).not.toHaveBeenCalled()
    expect(f.messages.get(providerAssistantMessageId("thread", "turn"))).toMatchObject({
      content: "partial answer", extra: { status: "timed_out" },
    })
    if (mode === "live") {
      expect(f.broadcast).toHaveBeenCalledWith(expect.objectContaining({
        channel: "provider.runtimeEvent",
        data: expect.objectContaining({ event_type: "turn_completed", payload: expect.objectContaining({ state: "timed_out", status: "timed_out" }) }),
      }))
    } else expect(f.broadcast).not.toHaveBeenCalled()
  })
})
