import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDatabase } from "../../persistence/db"
import { EventStore } from "../../persistence/eventStore"
import { runMigrations } from "../../persistence/migrations"
import { ProviderRuntimeEventJournal } from "./ProviderRuntimeEventJournal"
import type { ProviderRuntimeEvent as CanonicalProviderRuntimeEvent } from "./contracts"
import {
  canonicalJournalEntry,
  legacyJournalEntry,
  type ProviderRuntimeJournalEntry,
} from "./journalEntry"
import {
  providerRuntimeJournalRecoveryBlocksStartup,
  ProviderRuntimeJournalRecoveryStore,
} from "./ProviderRuntimeJournalRecoveryStore"

function setup() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bc0de-provider-journal-recovery-")
  )
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    directory,
    logger,
    store: new ProviderRuntimeJournalRecoveryStore(directory, { logger }),
  }
}

describe("ProviderRuntimeJournalRecoveryStore", () => {
  it("durably spools and replays provider events in order", () => {
    const { store } = setup()
    const first = {
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: { turn_id: "turn-1", delta: "hello" },
    }
    const second = {
      event_type: "turn_completed",
      thread_id: "thread-1",
      payload: { turn_id: "turn-1" },
    }
    expect(store.enqueue(legacyJournalEntry(first), { projectionSequence: 41 })).toBe(true)
    expect(store.enqueue(legacyJournalEntry(second), { projectionSequence: 42 })).toBe(true)
    const persist = vi.fn()

    expect(store.replay({ persist })).toEqual({
      replayed: 2,
      quarantined: 0,
      pending: 0,
    })
    expect(persist.mock.calls).toEqual([
      [legacyJournalEntry(first), 41, expect.any(String)],
      [legacyJournalEntry(second), 42, expect.any(String)],
    ])
    expect(persist.mock.calls[0]?.[2]).not.toBe(persist.mock.calls[1]?.[2])
  })

  it("keeps records pending when SQLite replay fails", () => {
    const { store } = setup()
    expect(
      store.enqueue(
        legacyJournalEntry({
          event_type: "turn_completed",
          thread_id: "thread-1",
          payload: { turn_id: "turn-1" },
        }),
        { projectionSequence: 50 }
      )
    ).toBe(true)

    expect(
      store.replay({
        persist: () => {
          throw new Error("database locked")
        },
      })
    ).toEqual({ replayed: 0, quarantined: 0, pending: 1 })
  })

  it("counts crash leftovers against the physical spool bound", () => {
    const { directory } = setup()
    fs.writeFileSync(path.join(directory, "orphan.tmp"), "crash residue")
    const store = new ProviderRuntimeJournalRecoveryStore(directory, { maxFiles: 1 })
    expect(store.enqueue(legacyJournalEntry({
      event_type: "turn_completed", thread_id: "thread-1", payload: {},
    }), { projectionSequence: 1 })).toBe(false)
    expect(store.pendingCount()).toBe(0)
  })

  it("quarantines malformed recovery records", () => {
    const { directory, store } = setup()
    fs.writeFileSync(
      path.join(
        directory,
        `${"1".padStart(20, "0")}-${Date.now()}-${crypto.randomUUID()}.json`
      ),
      "{broken",
      "utf8"
    )

    const result = store.replay({ persist: vi.fn() })
    expect(result).toEqual({
      replayed: 0,
      quarantined: 1,
      pending: 0,
    })
    expect(providerRuntimeJournalRecoveryBlocksStartup(result)).toBe(true)
    expect(fs.readdirSync(path.join(directory, "quarantine"))).toHaveLength(1)
    expect(store.replay({ persist: vi.fn() })).toEqual(result)
  })

  it("does not replay suffix records while an earlier record is quarantined", () => {
    const { directory, store } = setup()
    fs.writeFileSync(
      path.join(
        directory,
        `${"1".padStart(20, "0")}-${Date.now()}-${crypto.randomUUID()}.json`
      ),
      "{broken",
      "utf8"
    )
    const suffix = {
      event_type: "content_delta",
      thread_id: "thread-quarantine-order",
      payload: { turn_id: "turn-1", delta: "must wait" },
    }
    expect(store.enqueue(legacyJournalEntry(suffix), { projectionSequence: 2 })).toBe(true)
    const persist = vi.fn()

    const first = store.replay({ persist })
    expect(first).toEqual({ replayed: 0, quarantined: 1, pending: 1 })
    expect(providerRuntimeJournalRecoveryBlocksStartup(first)).toBe(true)
    expect(persist).not.toHaveBeenCalled()

    const second = store.replay({ persist })
    expect(second).toEqual(first)
    expect(persist).not.toHaveBeenCalled()
  })

  it("retries commit-to-delete crashes idempotently with the stable event id", () => {
    const { directory, store } = setup()
    const event = {
      event_type: "turn_completed",
      thread_id: "thread-idempotent",
      payload: { turn_id: "turn-1" },
    }
    expect(store.enqueue(legacyJournalEntry(event), { projectionSequence: 71 })).toBe(true)

    const db = openDatabase(path.join(directory, "events.sqlite"))
    runMigrations(db)
    const events = new EventStore(db)
    const journal = new ProviderRuntimeEventJournal(events)
    const commitThenCrash = {
      persist: (
        replayed: ProviderRuntimeJournalEntry,
        sequence: number,
        recoveryEventId?: string
      ) => {
        journal.persist(replayed, sequence, recoveryEventId)
        throw new Error("crash before recovery file delete")
      },
    }

    expect(store.replay(commitThenCrash)).toEqual({
      replayed: 0,
      quarantined: 0,
      pending: 1,
    })
    expect(events.readUnprojectedProviderRuntimeEvents(10)).toHaveLength(1)

    expect(store.replay(journal)).toEqual({
      replayed: 1,
      quarantined: 0,
      pending: 0,
    })
    expect(events.readUnprojectedProviderRuntimeEvents(10)).toHaveLength(1)
    db.close()
  })

  it("deduplicates only identical stream events and preserves distinct ones", () => {
    const { directory, store } = setup()
    const repeated = {
      event_type: "content_delta",
      thread_id: "thread-sequence",
      payload: { turn_id: "turn-1", delta: "same" },
    }
    const distinct = {
      ...repeated,
      payload: { turn_id: "turn-1", delta: "different" },
    }
    expect(store.enqueue(legacyJournalEntry(repeated), { projectionSequence: 80 })).toBe(true)
    expect(store.enqueue(legacyJournalEntry(repeated), { projectionSequence: 80 })).toBe(true)
    expect(store.enqueue(legacyJournalEntry(distinct), { projectionSequence: 80 })).toBe(true)

    const db = openDatabase(path.join(directory, "events.sqlite"))
    runMigrations(db)
    const events = new EventStore(db)
    const journal = new ProviderRuntimeEventJournal(events)

    expect(store.replay(journal)).toEqual({
      replayed: 3,
      quarantined: 0,
      pending: 0,
    })
    const stored = events.readProviderRuntimeByStreamVersion(
      "thread-sequence",
      80
    )
    expect(stored).toHaveLength(2)
    expect(stored.map((entry) => JSON.parse(entry.payload_json))).toEqual([
      repeated,
      distinct,
    ])
    db.close()
  })
})

describe("ProviderRuntimeJournalRecoveryStore entry envelopes", () => {
  const canonical: CanonicalProviderRuntimeEvent = {
    type: "tool.completed",
    threadId: "thread-spool",
    eventId: "evt-spool-1",
    turnId: "turn-1",
    providerKind: "codex",
    at: 5,
    toolId: "tool-1",
    toolName: "exec_command",
    output: { stdout: "ok" },
  }

  it("round-trips a canonical entry through a version 3 record", () => {
    const { directory, store } = setup()
    expect(
      store.enqueue(canonicalJournalEntry(canonical), { projectionSequence: 90 })
    ).toBe(true)
    const [fileName] = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
    const record = JSON.parse(
      fs.readFileSync(path.join(directory, fileName!), "utf8")
    ) as Record<string, unknown>
    expect(record).toMatchObject({
      version: 3,
      shape: "canonical",
      projectionSequence: 90,
      event: canonical,
    })
    expect(typeof record.eventId).toBe("string")
    expect(typeof record.queuedAt).toBe("string")

    const persist = vi.fn()
    expect(store.replay({ persist })).toEqual({
      replayed: 1,
      quarantined: 0,
      pending: 0,
    })
    expect(persist).toHaveBeenCalledWith(
      { shape: "canonical", event: canonical },
      90,
      record.eventId
    )
  })

  it("still replays version 1 and version 2 records as legacy entries", () => {
    const { directory, store } = setup()
    const legacy = {
      event_type: "turn_completed",
      thread_id: "thread-spool",
      payload: { turn_id: "turn-1" },
    }
    const v1Name = `${"1".padStart(20, "0")}-${Date.now()}-${crypto.randomUUID()}.json`
    fs.writeFileSync(
      path.join(directory, v1Name),
      `${JSON.stringify({
        version: 1,
        queuedAt: new Date().toISOString(),
        projectionSequence: 1,
        event: legacy,
      })}\n`,
      "utf8"
    )
    fs.writeFileSync(
      path.join(
        directory,
        `${"2".padStart(20, "0")}-${Date.now()}-${crypto.randomUUID()}.json`
      ),
      `${JSON.stringify({
        version: 2,
        eventId: "spool-v2-event",
        queuedAt: new Date().toISOString(),
        projectionSequence: 2,
        event: legacy,
      })}\n`,
      "utf8"
    )
    const persist = vi.fn()

    expect(store.replay({ persist })).toEqual({
      replayed: 2,
      quarantined: 0,
      pending: 0,
    })
    expect(persist.mock.calls).toEqual([
      [
        { shape: "legacy", event: legacy },
        1,
        `legacy-provider-runtime-recovery:${v1Name}`,
      ],
      [{ shape: "legacy", event: legacy }, 2, "spool-v2-event"],
    ])
  })

  it("quarantines a version 3 record whose shape and event disagree", () => {
    const { directory, store } = setup()
    fs.writeFileSync(
      path.join(
        directory,
        `${"3".padStart(20, "0")}-${Date.now()}-${crypto.randomUUID()}.json`
      ),
      `${JSON.stringify({
        version: 3,
        eventId: "spool-bad",
        queuedAt: new Date().toISOString(),
        projectionSequence: 3,
        shape: "canonical",
        // Legacy-shaped body under a canonical shape marker.
        event: { event_type: "turn_completed", thread_id: "t", payload: {} },
      })}\n`,
      "utf8"
    )
    const persist = vi.fn()
    expect(store.replay({ persist })).toEqual({
      replayed: 0,
      quarantined: 1,
      pending: 0,
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it("commits a spooled canonical entry as a schema 3 row through the real journal", () => {
    const { directory, store } = setup()
    expect(
      store.enqueue(canonicalJournalEntry(canonical), { projectionSequence: 91 })
    ).toBe(true)
    const db = openDatabase(path.join(directory, "events.sqlite"))
    runMigrations(db)
    const events = new EventStore(db)
    const journal = new ProviderRuntimeEventJournal(events)

    expect(store.replay(journal)).toEqual({
      replayed: 1,
      quarantined: 0,
      pending: 0,
    })
    const [row] = events.readProviderRuntimeByStreamVersion("thread-spool", 91)
    expect(row).toMatchObject({
      event_type: "ProviderRuntime:tool.completed",
      stream_id: "thread-spool",
    })
    expect(JSON.parse(row!.payload_json)).toEqual(canonical)
    expect(JSON.parse(row!.metadata_json)).toMatchObject({ schema: 3 })
    db.close()
  })
})
