import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDatabase } from "../../persistence/db"
import { EventStore } from "../../persistence/eventStore"
import { runMigrations } from "../../persistence/migrations"
import type { ProviderRuntimeEvent as CanonicalProviderRuntimeEvent } from "./contracts"
import { canonicalToLegacy } from "./legacyBridge"
import {
  CANONICAL_JOURNAL_FIXTURES,
  RAW_HEAVY_TOOL_COMPLETED_FIXTURE,
  cloneFixtureEvent,
  oversizedDiffFixture,
  oversizedToolCompletedManyBlocksFixture,
  oversizedToolCompletedNestedFixture,
  oversizedToolCompletedNestedIdentityFixture,
} from "./testUtils/canonicalJournalFixtures"
import {
  JOURNAL_PAYLOAD_TRUNCATED_KEY,
  JOURNAL_TRUNCATION_MARKER_KEY,
  MAX_JOURNALED_PROVIDER_EVENT_BYTES,
  ProviderRuntimeEventJournal,
  ProviderRuntimeJournalSerializationError,
} from "./ProviderRuntimeEventJournal"
import { canonicalJournalEntry, legacyJournalEntry } from "./journalEntry"

describe("ProviderRuntimeEventJournal", () => {
  it("stores the complete canonical event in the append-only event log", () => {
    const append = vi.fn(() => [{ sequence: 41 }])
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)
    const event = {
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: { turn_id: "turn-1", delta: "hello" },
    }

    expect(journal.persist(legacyJournalEntry(event), 17)).toEqual({
      sequence: 41,
      entry: { shape: "legacy", event },
      truncation: null,
    })

    expect(append).toHaveBeenCalledWith([
      expect.objectContaining({
        aggregate_kind: "provider_runtime",
        stream_id: "thread-1",
        stream_version: 17,
        event_type: "ProviderRuntime:content_delta",
        actor_kind: "provider",
        payload_json: JSON.stringify(event),
        metadata_json: JSON.stringify({
          schema: 2,
          contract: "provider-runtime-event",
          durability: "journal-first",
        }),
      }),
    ])
  })

  it("journals an oversized event with bounded string values instead of rejecting it", () => {
    const append = vi.fn((_events: unknown[]) => [{ sequence: 42 }])
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)

    const persisted = journal.persist(
      legacyJournalEntry({
        event_type: "tool_result",
        thread_id: "thread-1",
        payload: {
          turn_id: "turn-1",
          tool_name: "exec_command",
          output: "x".repeat(2 * 1024 * 1024),
          nested: { detail: "y".repeat(2 * 1024 * 1024), keep: 7 },
        },
      }),
      18
    )
    expect(persisted.sequence).toBe(42)

    expect(append).toHaveBeenCalledOnce()
    const [row] = (append.mock.calls[0] as unknown as [Array<Record<string, string>>])[0]
    expect(row).toBeDefined()
    expect(Buffer.byteLength(row!.payload_json!, "utf8")).toBeLessThanOrEqual(
      MAX_JOURNALED_PROVIDER_EVENT_BYTES
    )
    const stored = JSON.parse(row!.payload_json!) as {
      event_type: string
      thread_id: string
      payload: Record<string, unknown>
    }
    expect(stored.event_type).toBe("tool_result")
    expect(stored.thread_id).toBe("thread-1")
    expect(stored.payload.turn_id).toBe("turn-1")
    expect(stored.payload.tool_name).toBe("exec_command")
    expect((stored.payload.nested as { keep: number }).keep).toBe(7)
    expect(typeof stored.payload.output).toBe("string")
    // Cut clean: no inline suffix that would corrupt parsed output.
    expect(stored.payload.output as string).toMatch(/^x+$/)
    expect(stored.payload[JOURNAL_PAYLOAD_TRUNCATED_KEY]).toBe(true)
    expect(stored.payload[JOURNAL_TRUNCATION_MARKER_KEY]).toEqual({
      truncated: true,
      originalBytes: expect.any(Number),
      stringCapBytes: expect.any(Number),
      fields: ["output", "nested.detail"],
    })
    expect(JSON.parse(row!.metadata_json!)).toEqual({
      schema: 2,
      contract: "provider-runtime-event",
      durability: "journal-first",
      payloadTruncated: true,
      originalBytes: expect.any(Number),
    })
    // The caller gets the journaled copy back so it projects the same thing.
    expect(persisted.entry).toEqual({ shape: "legacy", event: stored })
    expect(persisted.truncation).toEqual({
      originalBytes: expect.any(Number),
      stringCapBytes: expect.any(Number),
      fields: ["output", "nested.detail"],
    })
  })

  it("drops the patch of an oversized diff event instead of cutting it", () => {
    const append = vi.fn((_events: unknown[]) => [{ sequence: 43 }])
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)

    const persisted = journal.persist(
      legacyJournalEntry({
        event_type: "turn.diff.updated",
        thread_id: "thread-1",
        payload: {
          turn_id: "turn-1",
          source: "checkpoint_reactor",
          unifiedDiff: "+".repeat(2 * 1024 * 1024),
          files: [{ path: "a.ts", additions: 1, deletions: 0 }],
        },
      }),
      19
    )

    const stored = JSON.parse(
      (append.mock.calls[0] as unknown as [Array<Record<string, string>>])[0][0]!
        .payload_json!
    ) as { payload: Record<string, unknown> }
    // A partial unified diff is not a diff: the patch is gone, the existing
    // `diffTruncated` flag says so, and the file list survives.
    expect(stored.payload.unifiedDiff).toBeUndefined()
    expect(stored.payload).toMatchObject({
      turn_id: "turn-1",
      diffTruncated: true,
      diffTruncationReason: "journal_limit",
      files: [{ path: "a.ts", additions: 1, deletions: 0 }],
      [JOURNAL_PAYLOAD_TRUNCATED_KEY]: true,
    })
    expect(stored.payload[JOURNAL_TRUNCATION_MARKER_KEY]).toMatchObject({
      truncated: true,
      fields: ["unifiedDiff"],
    })
    expect(persisted.entry).toEqual({ shape: "legacy", event: stored })
  })

  it("preserves prototype-named JSON fields without creating inherited live fields", () => {
    const append = vi.fn((_events: Array<{ payload_json: string }>) => [{ sequence: 43 }])
    const journal = new ProviderRuntimeEventJournal({ append } as unknown as EventStore)
    const nested = JSON.parse('{"__proto__":{"forged":"inherited"},"constructor":"data"}') as Record<string, unknown>
    const persisted = journal.persist(legacyJournalEntry({
      event_type: "tool_result", thread_id: "thread-prototype", payload: {
        nested, output: "x".repeat(2 * 1024 * 1024),
      },
    }), 19)
    const stored = JSON.parse(append.mock.calls[0]![0][0]!.payload_json) as { payload: { nested: Record<string, unknown> } }
    const liveNested = (persisted.entry.event as { payload: { nested: Record<string, unknown> } }).payload.nested
    expect(Object.hasOwn(liveNested, "__proto__")).toBe(true)
    expect(liveNested.forged).toBeUndefined()
    expect(stored.payload.nested).toEqual(nested)
  })

  it("bounds a legacy event that is oversized only in aggregate, by descending past the caps that cut nothing", () => {
    const append = vi.fn((_events: unknown[]) => [{ sequence: 44 }])
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)
    // 25 blocks of 60 KiB: every string sits under the first cap (64 KiB),
    // the event as a whole is ~1.5 MiB. The old loop returned "unboundable"
    // at the first cap because it cut nothing.
    const blocks = Array.from({ length: 25 }, (_, index) => ({
      type: "text",
      text: String.fromCharCode(97 + index).repeat(60 * 1024),
    }))

    const persisted = journal.persist(
      legacyJournalEntry({
        event_type: "tool_result",
        thread_id: "thread-1",
        payload: { turn_id: "turn-1", tool_name: "mcp__docs__search", output: { content: blocks } },
      }),
      20
    )

    expect(persisted.sequence).toBe(44)
    const [row] = (append.mock.calls[0] as unknown as [Array<Record<string, string>>])[0]
    expect(Buffer.byteLength(row!.payload_json!, "utf8")).toBeLessThanOrEqual(
      MAX_JOURNALED_PROVIDER_EVENT_BYTES
    )
    const stored = JSON.parse(row!.payload_json!) as {
      payload: { output: { content: Array<{ text: string }> } } & Record<string, unknown>
    }
    expect(stored.payload.output.content).toHaveLength(25)
    expect(stored.payload.output.content[0]!.text).toMatch(/^a+$/)
    expect(Buffer.byteLength(stored.payload.output.content[0]!.text, "utf8")).toBe(32 * 1024)
    expect(persisted.truncation).toEqual({
      originalBytes: expect.any(Number),
      stringCapBytes: 32 * 1024,
      fields: blocks.map((_, index) => `output.content[${index}].text`),
    })
  })

  it("still rejects an event that stays oversized after every string is bounded", () => {
    const append = vi.fn((_events: unknown[]) => [{ sequence: 42 }])
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)
    // Thousands of short keys: no per-string cap can bring this under the
    // limit, so the structural size — not a big value — is the problem.
    const payload: Record<string, unknown> = { turn_id: "turn-1" }
    for (let index = 0; index < 5_000; index += 1) {
      payload[`k${index}`] = "v".repeat(300)
    }

    expect(() =>
      journal.persist(
        legacyJournalEntry({ event_type: "tool_result", thread_id: "thread-1", payload }),
        18
      )
    ).toThrow(ProviderRuntimeJournalSerializationError)
    expect(append).not.toHaveBeenCalled()
  })

  it("runs bounded provider-audit retention on startup and periodically", () => {
    let sequence = 0
    const append = vi.fn(() => [{ sequence: ++sequence }])
    const pruneProviderRuntimeEvents = vi.fn()
    const journal = new ProviderRuntimeEventJournal(
      { append, pruneProviderRuntimeEvents } as unknown as EventStore,
      {
        retentionMaxEvents: 25,
        retentionMaxAgeMs: 1_000,
        pruneEvery: 2,
        now: () => Date.parse("2026-01-01T00:00:10.000Z"),
      }
    )

    const event = {
      event_type: "turn_completed",
      thread_id: "thread-1",
      payload: { turn_id: "turn-1" },
    }
    journal.persist(legacyJournalEntry(event), 1)
    journal.persist(legacyJournalEntry(event), 2)

    expect(pruneProviderRuntimeEvents).toHaveBeenCalledTimes(2)
    expect(pruneProviderRuntimeEvents).toHaveBeenLastCalledWith({
      olderThan: "2026-01-01T00:00:09.000Z",
      maxEvents: 25,
    })
  })

  it("classifies unserializable events as permanent journal failures", () => {
    const append = vi.fn()
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)
    const payload: Record<string, unknown> = { value: 1n }
    payload.self = payload

    expect(() =>
      journal.persist(
        legacyJournalEntry({
          event_type: "provider.metadata.changed",
          thread_id: "thread-1",
          payload,
        }),
        19
      )
    ).toThrow(ProviderRuntimeJournalSerializationError)
    expect(append).not.toHaveBeenCalled()
  })
})

describe("ProviderRuntimeEventJournal canonical rows", () => {
  function captureJournal(sequenceStart = 100) {
    const rows: Array<{
      event_type: string
      stream_id: string
      stream_version: number
      payload_json: string
      metadata_json: string
    }> = []
    let sequence = sequenceStart
    const append = vi.fn((input: typeof rows) =>
      input.map((row) => {
        rows.push(row)
        return { sequence: ++sequence }
      })
    )
    const journal = new ProviderRuntimeEventJournal({
      append,
    } as unknown as EventStore)
    return { journal, rows, append }
  }

  it("stores the canonical event pure under schema 3, with raw stripped", () => {
    const { journal, rows } = captureJournal()
    const fixture = CANONICAL_JOURNAL_FIXTURES.find(
      (entry) => entry.name === "tool.completed with raw envelope"
    )!
    const event = cloneFixtureEvent(fixture.event)
    expect(event).toHaveProperty("raw")

    const persisted = journal.persist(canonicalJournalEntry(event), 23)

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toMatchObject({
      event_type: "ProviderRuntime:tool.completed",
      stream_id: "thread-fixture",
      stream_version: 23,
    })
    const { raw: _raw, ...withoutRaw } = event as { raw?: unknown }
    expect(JSON.parse(row.payload_json)).toEqual(withoutRaw)
    expect(row.payload_json).not.toContain('"raw"')
    expect(JSON.parse(row.metadata_json)).toEqual({
      schema: 3,
      contract: "provider-runtime-event",
      durability: "journal-first",
    })
    // What the caller projects is the journaled copy: canonical, raw-less.
    expect(persisted).toEqual({
      sequence: 101,
      entry: { shape: "canonical", event: withoutRaw },
      truncation: null,
    })
    // The input was not mutated.
    expect(event).toHaveProperty("raw")
  })

  it("bounds oversized strings at the event root and inside payload, recording the cut in metadata only", () => {
    const { journal, rows } = captureJournal()
    const persisted = journal.persist(
      canonicalJournalEntry(oversizedToolCompletedNestedFixture()),
      24
    )

    const row = rows[0]!
    expect(Buffer.byteLength(row.payload_json, "utf8")).toBeLessThanOrEqual(
      MAX_JOURNALED_PROVIDER_EVENT_BYTES
    )
    const stored = JSON.parse(row.payload_json) as Record<string, unknown> & {
      payload: { data: { stdout: string; keep: number } }
    }
    // Identity survives untouched; the big strings are cut clean.
    expect(stored).toMatchObject({
      type: "tool.completed",
      threadId: "thread-fixture",
      eventId: "evt-tool-completed-big-nested",
      turnId: "turn-1",
      toolId: "tool-big-nested",
      toolName: "exec_command",
    })
    expect(stored.output).toMatch(/^x+$/)
    expect((stored.output as string).length).toBeLessThan(2 * 1024 * 1024)
    expect(stored.payload.data.stdout).toMatch(/^y+$/)
    expect(stored.payload.data.keep).toBe(7)
    // No marker inside the canonical event, at the root or in payload.
    expect(stored).not.toHaveProperty(JOURNAL_PAYLOAD_TRUNCATED_KEY)
    expect(stored).not.toHaveProperty(JOURNAL_TRUNCATION_MARKER_KEY)
    expect(stored.payload).not.toHaveProperty(JOURNAL_PAYLOAD_TRUNCATED_KEY)
    expect(stored.payload).not.toHaveProperty(JOURNAL_TRUNCATION_MARKER_KEY)
    expect(JSON.parse(row.metadata_json)).toEqual({
      schema: 3,
      contract: "provider-runtime-event",
      durability: "journal-first",
      payloadTruncated: true,
      originalBytes: expect.any(Number),
      stringCapBytes: expect.any(Number),
      truncatedFields: ["output", "payload.data.stdout"],
    })
    expect(persisted.entry).toEqual({ shape: "canonical", event: stored })
    expect(persisted.truncation).toEqual({
      originalBytes: expect.any(Number),
      stringCapBytes: expect.any(Number),
      fields: ["output", "payload.data.stdout"],
    })
  })

  it("bounds a canonical event of many sub-cap strings instead of rejecting it as unboundable", () => {
    const { journal, rows } = captureJournal()
    const event = oversizedToolCompletedManyBlocksFixture()
    expect(Buffer.byteLength(JSON.stringify(event), "utf8")).toBeGreaterThan(
      MAX_JOURNALED_PROVIDER_EVENT_BYTES
    )

    const persisted = journal.persist(canonicalJournalEntry(event), 26)

    const row = rows[0]!
    expect(Buffer.byteLength(row.payload_json, "utf8")).toBeLessThanOrEqual(
      MAX_JOURNALED_PROVIDER_EVENT_BYTES
    )
    const stored = JSON.parse(row.payload_json) as {
      output: { content: Array<{ type: string; text: string }> }
    }
    expect(stored.output.content).toHaveLength(25)
    for (const [index, block] of stored.output.content.entries()) {
      expect(block.type).toBe("text")
      expect(Buffer.byteLength(block.text, "utf8"), `block ${index}`).toBe(32 * 1024)
    }
    const expectedFields = Array.from(
      { length: 25 },
      (_, index) => `output.content[${index}].text`
    )
    expect(JSON.parse(row.metadata_json)).toMatchObject({
      schema: 3,
      payloadTruncated: true,
      stringCapBytes: 32 * 1024,
      truncatedFields: expectedFields,
    })
    expect(persisted.truncation).toEqual({
      originalBytes: expect.any(Number),
      stringCapBytes: 32 * 1024,
      fields: expectedFields,
    })
  })

  it("never cuts an identity string, at any depth, even when the cap falls below its length", () => {
    const { journal, rows } = captureJournal()
    const event = oversizedToolCompletedNestedIdentityFixture()

    const persisted = journal.persist(canonicalJournalEntry(event), 27)

    const row = rows[0]!
    expect(Buffer.byteLength(row.payload_json, "utf8")).toBeLessThanOrEqual(
      MAX_JOURNALED_PROVIDER_EVENT_BYTES
    )
    const stored = JSON.parse(row.payload_json) as {
      output: { lines: string[] }
      payload: {
        dispatchTurnId: string
        toolUseId: string
        requestId: string
        detail: string
        nested: { turn_id: string; note: string }
      }
    }
    // The cut had to go all the way down to the 256 B floor...
    expect(persisted.truncation?.stringCapBytes).toBe(256)
    expect(stored.output.lines).toHaveLength(3_000)
    expect(stored.output.lines[0]!.length).toBe(256)
    // ...and the 300-character ids survived it at every depth, while the
    // non-identity strings beside them were cut.
    expect(stored.payload.dispatchTurnId).toBe("d".repeat(300))
    expect(stored.payload.toolUseId).toBe("u".repeat(300))
    expect(stored.payload.requestId).toBe("r".repeat(300))
    expect(stored.payload.nested.turn_id).toBe("t".repeat(300))
    expect(stored.payload.nested.note.length).toBe(256)
    expect(stored.payload.detail.length).toBe(256)
    const fields = persisted.truncation!.fields
    expect(fields).toContain("payload.detail")
    expect(fields).toContain("payload.nested.note")
    expect(fields).toContain("output.lines[0]")
    expect(fields).not.toContain("payload.dispatchTurnId")
    expect(fields).not.toContain("payload.toolUseId")
    expect(fields).not.toContain("payload.requestId")
    expect(fields).not.toContain("payload.nested.turn_id")
  })

  it("drops the patch of an oversized canonical diff and flags it as a journal-limit truncation", () => {
    const { journal, rows } = captureJournal()
    journal.persist(canonicalJournalEntry(oversizedDiffFixture()), 25)

    const stored = JSON.parse(rows[0]!.payload_json) as {
      type: string
      payload: Record<string, unknown>
    }
    expect(stored.type).toBe("turn.diff.updated")
    expect(stored.payload.unifiedDiff).toBeUndefined()
    expect(stored.payload).toEqual({
      files: [{ path: "a.ts", additions: 1, deletions: 0 }],
      diffTruncated: true,
      diffTruncationReason: "journal_limit",
    })
    expect(JSON.parse(rows[0]!.metadata_json)).toMatchObject({
      schema: 3,
      payloadTruncated: true,
      truncatedFields: ["payload.unifiedDiff"],
    })
  })

  it("keeps canonical rows within the measured size of their legacy twins, and would catch raw leaking back", () => {
    // Journal size is the cost of journaling canonical: base fields plus
    // `payload`. `raw` is stripped because it is the one term that would
    // multiply the row. Measured over this corpus (row = payload + metadata):
    // per-row 0.80x–1.355x (the top is `session.exited`, whose fixture
    // carries reason/exitKind at the root and again in `payload`; the
    // legacy twin has them once), 1.008x in total. The bounds sit just above
    // that. They are only worth having if a leak would trip them: the
    // corpus's own raw envelope is ~125 B and lands at 1.37x with raw — under
    // the old 1.5x per-row bound, so that guard never fired — hence the
    // 4 KiB envelope fixture, which lands at ~15x.
    const PER_ROW_BOUND = 1.4
    const TOTAL_BOUND = 1.1
    const { journal, rows } = captureJournal()
    let totalLegacy = 0
    let totalCanonical = 0
    let totalWithRawLeaked = 0
    const withRawRatios = new Map<string, number>()
    for (const fixture of [...CANONICAL_JOURNAL_FIXTURES, RAW_HEAVY_TOOL_COMPLETED_FIXTURE]) {
      const legacy = canonicalToLegacy(cloneFixtureEvent(fixture.event))
      if (!legacy) continue
      journal.persist(canonicalJournalEntry(cloneFixtureEvent(fixture.event)), 1)
      const canonicalRow = rows.pop()!
      journal.persist(legacyJournalEntry(legacy), 1)
      const legacyRow = rows.pop()!
      const canonicalBytes =
        Buffer.byteLength(canonicalRow.payload_json, "utf8") +
        Buffer.byteLength(canonicalRow.metadata_json, "utf8")
      const legacyBytes =
        Buffer.byteLength(legacyRow.payload_json, "utf8") +
        Buffer.byteLength(legacyRow.metadata_json, "utf8")
      expect(canonicalBytes, fixture.name).toBeLessThanOrEqual(PER_ROW_BOUND * legacyBytes)
      totalCanonical += canonicalBytes
      totalLegacy += legacyBytes
      // Simulated leak: the row as it would be if `stripRaw` stopped running.
      const withRawBytes =
        Buffer.byteLength(JSON.stringify(fixture.event), "utf8") +
        Buffer.byteLength(canonicalRow.metadata_json, "utf8")
      totalWithRawLeaked += withRawBytes
      if ("raw" in fixture.event) withRawRatios.set(fixture.name, withRawBytes / legacyBytes)
    }
    expect(totalLegacy).toBeGreaterThan(0)
    expect(totalCanonical).toBeLessThanOrEqual(TOTAL_BOUND * totalLegacy)

    // Non-vacuity: with raw leaked, the heavy envelope breaks the per-row
    // bound outright and the corpus as a whole breaks the total bound. The
    // small corpus envelope alone stays under the per-row bound — pinned so
    // nobody mistakes it for coverage.
    expect(withRawRatios.get(RAW_HEAVY_TOOL_COMPLETED_FIXTURE.name)).toBeGreaterThan(
      PER_ROW_BOUND
    )
    expect(withRawRatios.get("tool.completed with raw envelope")).toBeLessThan(PER_ROW_BOUND)
    expect(totalWithRawLeaked).toBeGreaterThan(TOTAL_BOUND * totalLegacy)
  })

  it("treats a spool replay as already committed when only the metadata marker differs", () => {
    // A row committed by an older binary carries `{}` or `{schema: 1}` in
    // metadata; migration 51 rewrites `{}` to `{schema: 1}`. Neither may make
    // a spool record look new — the row is the same journal write.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-journal-equiv-"))
    const db = openDatabase(path.join(dir, "events.sqlite"))
    runMigrations(db)
    const events = new EventStore(db)
    const event = {
      event_type: "turn_completed",
      thread_id: "thread-equivalent",
      payload: { turn_id: "turn-1" },
    }
    events.append([
      {
        event_id: "committed-by-older-binary",
        aggregate_kind: "provider_runtime",
        stream_id: "thread-equivalent",
        stream_version: 7,
        event_type: "ProviderRuntime:turn_completed",
        occurred_at: new Date().toISOString(),
        command_id: null,
        causation_event_id: null,
        correlation_id: null,
        actor_kind: "provider",
        payload_json: JSON.stringify(event),
        metadata_json: JSON.stringify({ schema: 1 }),
      },
    ])
    const journal = new ProviderRuntimeEventJournal(events)

    const replayed = journal.persist(legacyJournalEntry(event), 7, "spool-record-1")

    expect(replayed.sequence).toBe(1)
    expect(events.readProviderRuntimeByStreamVersion("thread-equivalent", 7)).toHaveLength(1)

    // A different payload at the same stream version is a distinct write.
    const distinct = { ...event, payload: { turn_id: "turn-2" } }
    journal.persist(legacyJournalEntry(distinct), 7, "spool-record-2")
    expect(events.readProviderRuntimeByStreamVersion("thread-equivalent", 7)).toHaveLength(2)

    // A canonical row is never equivalent to a legacy row of the same event:
    // the bytes differ, so the spool record is a new write.
    const canonical = cloneFixtureEvent(
      CANONICAL_JOURNAL_FIXTURES.find(
        (fixture) => fixture.name === "turn.completed status completed"
      )!.event
    )
    const canonicalReplay = journal.persist(
      canonicalJournalEntry({ ...canonical, threadId: "thread-equivalent" }),
      7,
      "spool-record-3"
    )
    expect(canonicalReplay.sequence).toBe(3)
    expect(events.readProviderRuntimeByStreamVersion("thread-equivalent", 7)).toHaveLength(3)
    // Replaying that same canonical record again is the same write.
    expect(
      journal.persist(
        canonicalJournalEntry({ ...canonical, threadId: "thread-equivalent" }),
        7,
        "spool-record-3-again"
      ).sequence
    ).toBe(3)
    expect(events.readProviderRuntimeByStreamVersion("thread-equivalent", 7)).toHaveLength(3)

    // A bounded row is never equivalent to an unbounded one, even when the
    // payload bytes agree: the bounded canonical row stores the cut event
    // pure, so an unbounded event carrying exactly that content differs only
    // in `payloadTruncated` — and that is enough.
    const bounded = journal.persist(
      canonicalJournalEntry({
        ...oversizedToolCompletedNestedFixture(),
        threadId: "thread-equivalent",
      }),
      8
    )
    expect(bounded.truncation).not.toBeNull()
    const unboundedTwin = journal.persist(
      canonicalJournalEntry(bounded.entry.event as CanonicalProviderRuntimeEvent),
      8,
      "spool-record-4"
    )
    expect(unboundedTwin.truncation).toBeNull()
    expect(unboundedTwin.sequence).not.toBe(bounded.sequence)
    const [first, second] = events.readProviderRuntimeByStreamVersion("thread-equivalent", 8)
    expect(first!.payload_json).toBe(second!.payload_json)
    expect(JSON.parse(first!.metadata_json)).toMatchObject({ payloadTruncated: true })
    expect(JSON.parse(second!.metadata_json)).not.toHaveProperty("payloadTruncated")
    db.close()
  })
})
