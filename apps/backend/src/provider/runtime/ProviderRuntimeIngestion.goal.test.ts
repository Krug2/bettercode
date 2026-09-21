import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import { httpContracts } from "@betterc0de/schema/http-contracts"
import { openDatabase, type Db } from "../../persistence/db"
import { runMigrations } from "../../persistence/migrations"
import { EventStore } from "../../persistence/eventStore"
import { ThreadService } from "../../services/threads/service"
import { ProviderRuntimeIngestion } from "./ProviderRuntimeIngestion"
import { ProviderRuntimeEventJournal } from "./ProviderRuntimeEventJournal"
import { ProviderRuntimeProjectionReceiptStore } from "./ProviderRuntimeProjectionReceiptStore"
import { ProviderRuntimeJournalReplayer } from "./ProviderRuntimeJournalReplayer"
import type { ProviderRuntimeEvent } from "./contracts"

const nativeGoal = {
  threadId: "native-1", objective: "Finish migration", status: "active",
  createdAt: 1_789_400_000, updatedAt: 1_789_400_100,
  tokensUsed: 321, tokenBudget: 10_000, timeUsedSeconds: 42,
}
const threadMeta = {
  thread_id: "thread-1", title: "Keep title", project_name: "Project", project_path: "/repo",
  created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:01:00.000Z",
  codex_thread_id: "native-1",
}
function goalEvent(goal: unknown, eventId = "goal-1"): ProviderRuntimeEvent {
  return {
    type: "thread.metadata.updated", eventId, threadId: "thread-1",
    providerKind: "codex", providerInstanceId: "codex-work", at: 1_789_400_100_000,
    payload: { metadata: { goal } },
  }
}

describe("durable provider goals", () => {
  let db: Db
  let tempDir: string
  let threads: ThreadService
  let events: EventStore
  let journal: ProviderRuntimeEventJournal
  let receipts: ProviderRuntimeProjectionReceiptStore
  let ingestion: ProviderRuntimeIngestion
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const broadcast = vi.fn()
  const snapshot = () => (threads.listThreads() as ChatThread[])[0]

  const build = (persist = true) => new ProviderRuntimeIngestion({
    eventBus: new EventEmitter(), eventJournal: journal, projectionReceipts: receipts,
    activityStore: { upsert: vi.fn() }, threadMetadataStore: threads,
    broadcaster: { broadcast, clientCount: () => 1 }, logger,
    shouldPersistConversations: () => persist,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-goal-projection-"))
    db = openDatabase(path.join(tempDir, "test.sqlite"))
    runMigrations(db)
    threads = new ThreadService(db)
    threads.upsertThreadMeta(threadMeta)
    events = new EventStore(db)
    journal = new ProviderRuntimeEventJournal(events)
    receipts = new ProviderRuntimeProjectionReceiptStore(db)
    ingestion = build()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    ingestion.stop()
    db.close()
    vi.useRealTimers()
    if (path.dirname(path.resolve(tempDir)) !== path.resolve(os.tmpdir()) || !path.basename(tempDir).startsWith("bc-goal-projection-")) {
      throw new Error("Unexpected temporary goal-test directory")
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("journals and persists native goal accounting before broadcasting, without reordering threads", () => {
    broadcast.mockImplementation((frame) => {
      if (frame.data?.event_type !== "thread.metadata.updated") return
      expect(snapshot().goal).toMatchObject({ objective: nativeGoal.objective, tokens: 321 })
      expect(receipts.get(1)?.status).toBe("projected")
    })
    ingestion.ingestCanonical(goalEvent({ goal: nativeGoal }))
    expect(snapshot()).toMatchObject({ title: "Keep title", updatedAt: threadMeta.updated_at,
      goal: { status: "active", providerKind: "codex", tokens: 321, tokenBudget: 10_000, timeUsedSeconds: 42 } })
    expect(broadcast).toHaveBeenCalled()
    // Drop every in-memory service and reopen the database as on app restart.
    ingestion.stop()
    db.close()
    db = openDatabase(path.join(tempDir, "test.sqlite"))
    threads = new ThreadService(db)
    events = new EventStore(db)
    journal = new ProviderRuntimeEventJournal(events)
    receipts = new ProviderRuntimeProjectionReceiptStore(db)
    ingestion = build()
    expect(snapshot().goal?.startedAt).toBe(nativeGoal.createdAt * 1000)
    const response = httpContracts.listThreads.response.parse(threads.listThreads())
    expect(response[0]?.goal).toEqual(snapshot().goal)
  })

  it("persists partial status updates and explicit clears across stale renderer saves", () => {
    expect(snapshot()).not.toHaveProperty("goal")
    ingestion.ingestCanonical(goalEvent(nativeGoal))
    ingestion.ingestCanonical(goalEvent({ status: "paused" }, "goal-2"))
    expect(snapshot().goal).toMatchObject({ status: "paused", tokens: 321 })
    threads.save({ ...threadMeta, messages: [] })
    expect(snapshot().goal?.status).toBe("paused")
    ingestion.ingestCanonical(goalEvent(null, "goal-3"))
    threads.save({ ...threadMeta, messages: [] })
    expect(snapshot().goal).toBeNull()
    expect(receipts.get(3)?.status).toBe("projected")
  })

  it("recovers a failed goal projection from the journal, silently and idempotently", () => {
    const write = vi.spyOn(threads, "updateThreadGoal").mockImplementationOnce(() => {
      throw new Error("temporary SQLite failure")
    })
    ingestion.ingestCanonical(goalEvent(nativeGoal))
    expect(snapshot()).not.toHaveProperty("goal")
    expect(receipts.get(1)).toBeNull()
    expect(broadcast.mock.calls.some(([frame]) => frame.data?.event_type === "thread.metadata.updated")).toBe(false)
    write.mockRestore()
    ingestion.stop()
    threads = new ThreadService(db)
    ingestion = build()
    broadcast.mockClear()
    const replayer = new ProviderRuntimeJournalReplayer(events, receipts, ingestion, logger)
    expect(replayer.replayAll()).toMatchObject({ replayed: 1, blocked: null })
    expect(snapshot().goal).toMatchObject({ status: "active", tokens: 321 })
    expect(replayer.replayAll().replayed).toBe(0)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it("does not change the goal before a failed journal append succeeds", () => {
    vi.useFakeTimers()
    const append = vi.spyOn(events, "append").mockImplementation(() => {
      throw new Error("journal temporarily unavailable")
    })
    ingestion.ingestCanonical(goalEvent(nativeGoal))
    expect(snapshot()).not.toHaveProperty("goal")
    append.mockRestore()
    vi.runOnlyPendingTimers()
    expect(snapshot().goal?.status).toBe("active")
    expect(receipts.get(1)?.status).toBe("projected")
  })

  it("respects disabled conversation persistence and ignores malformed or deleted-thread metadata", () => {
    ingestion.stop()
    ingestion = build(false)
    ingestion.ingestCanonical(goalEvent(nativeGoal))
    expect(snapshot()).not.toHaveProperty("goal")
    ingestion.stop()
    ingestion = build()
    ingestion.ingestCanonical(goalEvent({ goal: [] }, "malformed"))
    expect(snapshot()).not.toHaveProperty("goal")
    db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run("thread-1")
    ingestion.ingestCanonical(goalEvent(nativeGoal, "late-goal"))
    expect(threads.listThreads()).toEqual([])
  })
})
