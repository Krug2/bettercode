import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, type Db } from "./db";
import { runMigrations } from "./migrations";
import { EventStore } from "./eventStore";
import type { UnstoredEvent } from "./eventStore";

const fixtures: Array<{ db: Db; directory: string }> = [];
afterEach(() => {
  for (const { db, directory } of fixtures.splice(0)) {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeEvent(overrides: Partial<UnstoredEvent> = {}): UnstoredEvent {
  return {
    event_id: randomUUID(),
    aggregate_kind: "thread",
    // Most EventStore tests exercise global sequence/cursor behaviour rather
    // than one aggregate stream. Give each fixture its own stream so the
    // production uniqueness invariant is not accidentally violated.
    stream_id: randomUUID(),
    stream_version: 1,
    event_type: "ThreadCreated",
    occurred_at: new Date().toISOString(),
    command_id: randomUUID(),
    causation_event_id: null,
    correlation_id: null,
    actor_kind: "user",
    payload_json: JSON.stringify({ hello: "world" }),
    metadata_json: "{}",
    ...overrides,
  };
}

describe("EventStore", () => {
  let db: Db;
  let store: EventStore;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-evt-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
    fixtures.push({ db, directory: dir });
    runMigrations(db);
    store = new EventStore(db);
  });

  it("append returns events with strictly monotonic sequences", () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const stored = store.append(events);

    expect(stored).toHaveLength(3);
    expect(stored[0].sequence).toBeLessThan(stored[1].sequence);
    expect(stored[1].sequence).toBeLessThan(stored[2].sequence);
    // Each stored event preserves the input payload so the caller can route
    // by event_type + payload without another round-trip.
    for (let i = 0; i < stored.length; i += 1) {
      expect(stored[i].event_id).toBe(events[i].event_id);
      expect(stored[i].payload_json).toBe(events[i].payload_json);
    }
  });

  it("rolls back sequences outside JavaScript's safe integer range with the default driver mode", () => {
    const [first] = store.append([makeEvent()]);
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'orchestration_events'")
      .run(Number.MAX_SAFE_INTEGER);
    expect(() => store.append([makeEvent()])).toThrow(/MAX_SAFE_INTEGER/);
    expect(store.readFromSequence(0, 10)).toEqual([first]);
  });

  it("readFromSequence returns events appended after the given cursor", () => {
    const batch1 = store.append([makeEvent(), makeEvent()]);
    const batch2 = store.append([makeEvent(), makeEvent()]);

    const afterFirstBatch = store.readFromSequence(
      batch1[batch1.length - 1].sequence,
      10
    );
    expect(afterFirstBatch.map((e) => e.event_id)).toEqual(
      batch2.map((e) => e.event_id)
    );

    const all = store.readFromSequence(0, 100);
    expect(all).toHaveLength(4);
  });

  it("respects the limit parameter", () => {
    store.append([makeEvent(), makeEvent(), makeEvent(), makeEvent()]);
    const page = store.readFromSequence(0, 2);
    expect(page).toHaveLength(2);
  });

  it("excludes provider audit traffic from orchestration replay", () => {
    const orchestration = makeEvent({ event_type: "ThreadCreated" });
    const provider = makeEvent({
      aggregate_kind: "provider_runtime",
      event_type: "ProviderRuntime:tool_result",
      command_id: null,
    });
    const laterOrchestration = makeEvent({ event_type: "TurnStarted" });
    store.append([orchestration, provider, laterOrchestration]);

    expect(
      store.readOrchestrationFromSequence(0, 10).map((event) => event.event_id)
    ).toEqual([orchestration.event_id, laterOrchestration.event_id]);
    expect(store.readFromSequence(0, 10)).toHaveLength(3);
  });

  it("returns only provider runtime events without projection receipts", () => {
    const providerEvents = store.append([
      makeEvent({
        aggregate_kind: "provider_runtime",
        event_type: "ProviderRuntime:turn_started",
        command_id: null,
      }),
      makeEvent({
        aggregate_kind: "provider_runtime",
        event_type: "ProviderRuntime:turn_completed",
        command_id: null,
        stream_version: 2,
      }),
    ]);
    store.append([makeEvent({ event_type: "ThreadCreated" })]);
    db.prepare(`
      INSERT INTO provider_runtime_projection_receipts
        (event_sequence, status, error, projected_at)
      VALUES (?, 'projected', NULL, ?)
    `).run(providerEvents[0].sequence, new Date().toISOString());

    expect(store.readUnprojectedProviderRuntimeEvents(10)).toEqual([
      providerEvents[1],
    ]);
  });

  it("prunes provider audit by age and global count without touching orchestration", () => {
    const oldProvider = makeEvent({
      aggregate_kind: "provider_runtime",
      event_type: "ProviderRuntime:old",
      occurred_at: "2025-01-01T00:00:00.000Z",
    });
    const recentProviders = [1, 2, 3].map((streamVersion) =>
      makeEvent({
        aggregate_kind: "provider_runtime",
        event_type: `ProviderRuntime:recent-${streamVersion}`,
        occurred_at: `2026-01-0${streamVersion}T00:00:00.000Z`,
        stream_version: streamVersion,
      })
    );
    const orchestration = makeEvent({
      event_type: "ThreadCreated",
      occurred_at: "2025-01-01T00:00:00.000Z",
    });
    store.append([oldProvider, ...recentProviders, orchestration]);
    db.prepare(`
      INSERT INTO provider_runtime_projection_receipts
        (event_sequence, status, error, projected_at)
      SELECT sequence, 'projected', NULL, ?
      FROM orchestration_events
      WHERE aggregate_kind = 'provider_runtime'
    `).run(new Date().toISOString());

    expect(
      store.pruneProviderRuntimeEvents({
        olderThan: "2026-01-01T00:00:00.000Z",
        maxEvents: 2,
      })
    ).toBe(2);

    const remaining = store.readFromSequence(0, 10);
    expect(remaining.map((event) => event.event_id)).toEqual([
      recentProviders[1].event_id,
      recentProviders[2].event_id,
      orchestration.event_id,
    ]);
  });

  it("never prunes provider runtime events that still need projection", () => {
    const [pending, projected] = store.append([
      makeEvent({
        aggregate_kind: "provider_runtime",
        event_type: "ProviderRuntime:pending",
        occurred_at: "2025-01-01T00:00:00.000Z",
      }),
      makeEvent({
        aggregate_kind: "provider_runtime",
        event_type: "ProviderRuntime:projected",
        occurred_at: "2025-01-01T00:00:00.000Z",
        stream_version: 2,
      }),
    ]);
    db.prepare(`
      INSERT INTO provider_runtime_projection_receipts
        (event_sequence, status, error, projected_at)
      VALUES (?, 'projected', NULL, ?)
    `).run(projected.sequence, new Date().toISOString());

    expect(
      store.pruneProviderRuntimeEvents({
        olderThan: "2026-01-01T00:00:00.000Z",
        maxEvents: 0,
      })
    ).toBe(1);
    expect(store.readFromSequence(0, 10)).toEqual([pending]);
    expect(store.readUnprojectedProviderRuntimeEvents(10)).toEqual([pending]);
  });
});

function explainPlan(db: Db, sql: string): string {
  const params = Array.from(
    { length: (sql.match(/\?/g) ?? []).length },
    () => "x"
  )
  return (
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
      detail: string
    }>
  )
    .map((row) => row.detail)
    .join("\n")
}

function statementSource(owner: object, name: string): string {
  const statement = (owner as Record<string, { source: string }>)[name]
  if (!statement) throw new Error(`unknown statement ${name}`)
  return statement.source
}

describe("EventStore provider runtime retention", () => {
  let db: Db;
  let store: EventStore;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-evt-prune-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
    fixtures.push({ db, directory: dir });
    runMigrations(db);
    store = new EventStore(db);
  });

  it("bounds count-based pruning by the receipts primary key instead of scanning the log", () => {
    const cutoff = explainPlan(
      db,
      statementSource(store, "providerRuntimeRetentionCutoffStmt")
    );
    expect(cutoff).not.toContain("orchestration_events");
    expect(cutoff).not.toContain("USE TEMP B-TREE");

    const overflow = explainPlan(
      db,
      statementSource(store, "deleteProjectedProviderRuntimeUpToStmt")
    );
    // Receipts drive the candidate set (a bounded rowid range), and each
    // candidate is a primary-key probe on the log — never a log scan.
    expect(overflow).toMatch(
      /provider_runtime_projection_receipts USING (INTEGER PRIMARY KEY \(rowid<\?\)|COVERING INDEX \w+ \(.*event_sequence<\?\))/
    );
    expect(overflow).toContain("orchestration_events USING INTEGER PRIMARY KEY (rowid=?)");
    expect(overflow).not.toMatch(/SCAN orchestration_events/);
    expect(overflow).not.toContain("USE TEMP B-TREE");
  });

  it("keeps the newest N projected events and never counts unprojected ones against them", () => {
    const projected = store.append(
      [1, 2, 3, 4, 5].map((streamVersion) =>
        makeEvent({
          aggregate_kind: "provider_runtime",
          occurred_at: "2026-06-01T00:00:00.000Z",
          stream_version: streamVersion,
        })
      )
    );
    const pending = store.append(
      [6, 7].map((streamVersion) =>
        makeEvent({
          aggregate_kind: "provider_runtime",
          occurred_at: "2026-06-01T00:00:00.000Z",
          stream_version: streamVersion,
        })
      )
    );
    const receipt = db.prepare(`
      INSERT INTO provider_runtime_projection_receipts
        (event_sequence, status, error, projected_at)
      VALUES (?, 'projected', NULL, ?)
    `);
    for (const event of projected) receipt.run(event.sequence, "2026-06-01T00:00:00.000Z");

    expect(
      store.pruneProviderRuntimeEvents({
        olderThan: "2026-01-01T00:00:00.000Z",
        maxEvents: 3,
      })
    ).toBe(2);
    expect(store.readFromSequence(0, 10).map((event) => event.event_id)).toEqual([
      projected[2].event_id,
      projected[3].event_id,
      projected[4].event_id,
      pending[0].event_id,
      pending[1].event_id,
    ]);
    // Receipts of pruned events cascade away, so a second prune is a no-op.
    expect(
      store.pruneProviderRuntimeEvents({
        olderThan: "2026-01-01T00:00:00.000Z",
        maxEvents: 3,
      })
    ).toBe(0);
  });
});
