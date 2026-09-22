import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { ThreadSaveMessage } from "../../services/threads/types"
import { ProviderRuntimeIngestion } from "./ProviderRuntimeIngestion"
import { legacyJournalEntry } from "./journalEntry"

function setup(initial?: ThreadSaveMessage) {
  let message = initial
  const ingestion = new ProviderRuntimeIngestion({
    eventBus: new EventEmitter(),
    activityStore: { upsert: vi.fn() },
    broadcaster: { broadcast: vi.fn(), clientCount: () => 0 },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    transcriptStore: { getMessage: () => message ?? null, upsertMessage: request => { message = request.message } },
  })
  const send = (type: string, payload: Record<string, unknown>, sequence: number) => ingestion.replayPersisted(legacyJournalEntry({
    event_type: type, thread_id: "usage-thread", payload: { turn_id: "turn-1", providerKind: "claude", ...payload },
  }), { projectionSequence: sequence })
  return { send, message: () => message }
}

describe("recorded provider usage", () => {
  it("replaces cumulative turn snapshots and preserves them through completion", () => {
    const runtime = setup()
    runtime.send("content_delta", { delta: "answer" }, 1)
    runtime.send("token_usage", { usage: { inputTokens: 10, outputTokens: 2, totalCostUsd: 0.1 } }, 2)
    runtime.send("token_usage", { usage: { inputTokens: 20, outputTokens: 4, totalCostUsd: 0.2, cacheReadTokens: 8 } }, 3)
    runtime.send("turn_completed", { status: "completed" }, 4)
    expect(runtime.message()).toMatchObject({ content: "answer", extra: { usage: { inputTokens: 20, outputTokens: 4, totalCostUsd: 0.2, cacheReadTokens: 8 } } })
  })

  it("keeps the latest usage when replay restarts from an older event", () => {
    const first = setup()
    first.send("token_usage", { usage: { inputTokens: 40, outputTokens: 10 } }, 20)
    const replay = setup(first.message())
    replay.send("token_usage", { usage: { inputTokens: 5, outputTokens: 1 } }, 19)
    replay.send("turn_completed", {}, 21)
    expect(replay.message()?.extra?.usage).toEqual({ inputTokens: 40, outputTokens: 10 })
  })

  it("ignores context window snapshots and rejects invalid usage fields", () => {
    const runtime = setup()
    runtime.send("thread.token-usage.updated", { usage: { inputTokens: 90000, usedTokens: 91000 } }, 1)
    expect(runtime.message()).toBeUndefined()
    runtime.send("token_usage", { usage: { inputTokens: 0, outputTokens: 12, totalCostUsd: -1, unrelated: "payload" } }, 2)
    expect(runtime.message()?.extra?.usage).toEqual({ inputTokens: 0, outputTokens: 12 })
  })
})
