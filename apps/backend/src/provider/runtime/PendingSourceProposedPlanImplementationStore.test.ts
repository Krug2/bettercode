import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { openDatabase, type Db } from "../../persistence/db"
import { runMigrations } from "../../persistence/migrations"
import type { ThreadActivityProjection } from "../../persistence/projections"
import { SqlitePendingSourceProposedPlanImplementationStore } from "./PendingSourceProposedPlanImplementationStore"
import { ProviderRuntimeIngestion } from "./ProviderRuntimeIngestion"
import { legacyJournalEntry } from "./journalEntry"

function createDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-plan-pending-"))
  const db = openDatabase(path.join(dir, "test.sqlite"))
  runMigrations(db)
  const insertThread = db.prepare(`
    INSERT INTO projection_threads
      (thread_id, project_id, created_at, updated_at)
    VALUES (?, 'project-1', ?, ?)
  `)
  const now = new Date().toISOString()
  insertThread.run("thread-plan", now, now)
  insertThread.run("thread-implementation", now, now)
  return db
}

function pendingInput() {
  return {
    sourceProposedPlan: {
      threadId: "thread-plan",
      planId: "plan-1",
    },
    implementationThreadId: "thread-implementation",
    providerKind: "claude",
    providerInstanceId: "claude-main",
    acceptedTurnId: "turn-1",
  }
}

const lookup = {
  implementationThreadId: "thread-implementation",
  providerKind: "claudeAgent",
  providerInstanceId: "claude-main",
  acceptedTurnId: "turn-1",
}

describe("PendingSourceProposedPlanImplementationStore", () => {
  it("survives a store restart and acknowledges only a matching target", () => {
    const db = createDb()
    const store = new SqlitePendingSourceProposedPlanImplementationStore(db)
    store.recordPending(pendingInput())

    const restarted = new SqlitePendingSourceProposedPlanImplementationStore(db)
    expect(restarted.peekPending(lookup)).toEqual(pendingInput())
    expect(
      restarted.peekPending({ ...lookup, acceptedTurnId: "unrelated-turn" })
    ).toBeNull()

    restarted.ackPending({
      ...lookup,
      providerInstanceId: "different-instance",
    })
    expect(restarted.peekPending(lookup)).toEqual(pendingInput())

    restarted.ackPending(lookup)
    expect(restarted.peekPending(lookup)).toBeNull()
    db.close()
  })

  it("clears accepted links that have no recoverable turn start", () => {
    const db = createDb()
    const store = new SqlitePendingSourceProposedPlanImplementationStore(db)
    store.recordPending(pendingInput())

    expect(store.clearAll()).toBe(1)
    expect(store.peekPending(lookup)).toBeNull()
    expect(store.clearAll()).toBe(0)
    db.close()
  })

  it("does not let a late rejection clear a newer accepted turn", () => {
    const db = createDb()
    const store = new SqlitePendingSourceProposedPlanImplementationStore(db)
    store.recordPending({ ...pendingInput(), acceptedTurnId: "turn-a" })
    store.recordPending({ ...pendingInput(), acceptedTurnId: "turn-b" })

    store.clearPending({ ...lookup, acceptedTurnId: "turn-a" })

    expect(
      store.peekPending({ ...lookup, acceptedTurnId: "turn-b" })
    ).toMatchObject({ acceptedTurnId: "turn-b" })
    db.close()
  })

  it("keeps pending state after an activity upsert failure and replays it after restart", () => {
    const db = createDb()
    const store = new SqlitePendingSourceProposedPlanImplementationStore(db)
    store.recordPending(pendingInput())
    const activities: ThreadActivityProjection[] = []
    let failImplementedUpsert = true
    const activityStore = {
      upsert: (activity: ThreadActivityProjection) => {
        if (
          failImplementedUpsert &&
          activity.kind === "turn.proposed.implemented"
        ) {
          throw new Error("activity database unavailable")
        }
        activities.push(activity)
      },
    }
    const event = {
      event_type: "turn_started",
      thread_id: "thread-implementation",
      payload: {
        provider: "claudeAgent",
        providerInstanceId: "claude-main",
        turn_id: "turn-1",
        createdAt: "2026-07-11T05:00:00.000Z",
      },
    }
    const createIngestion = (
      pendingStore: SqlitePendingSourceProposedPlanImplementationStore
    ) =>
      new ProviderRuntimeIngestion({
        eventBus: new EventEmitter(),
        activityStore,
        sessionLifecycleStore: {
          get: vi.fn(() => ({ activeTurnId: null })),
          updateSessionLifecycle: vi.fn(),
        },
        sourceProposedPlanImplementations: pendingStore,
        broadcaster: {
          broadcast: vi.fn(),
          clientCount: vi.fn(() => 0),
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        sequenceStart: 0,
      })

    expect(() =>
      createIngestion(store).replayPersisted(legacyJournalEntry(event), {
        projectionSequence: 101,
      })
    ).toThrow("could not be replayed")
    expect(store.peekPending(lookup)).toEqual(pendingInput())

    failImplementedUpsert = false
    const restarted = new SqlitePendingSourceProposedPlanImplementationStore(db)
    createIngestion(restarted).replayPersisted(legacyJournalEntry(event), {
      projectionSequence: 101,
    })

    expect(restarted.peekPending(lookup)).toBeNull()
    expect(
      activities.filter(
        (activity) => activity.kind === "turn.proposed.implemented"
      )
    ).toHaveLength(1)
    db.close()
  })
})
