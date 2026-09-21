import type { Db } from "./db";

/**
 * Row shapes of the `orchestration_events` table. The table name is historic
 * (it predates the removal of the unused orchestration command loop); today
 * the append-only log carries the provider runtime journal, which is why the
 * journal lane (ProviderRuntimeEventJournal / JournalReplayer) imports these
 * types from here.
 */

/** Event not yet persisted — fed to EventStore.append. */
export interface UnstoredEvent {
  event_id: string;
  aggregate_kind: string;
  stream_id: string;
  stream_version: number;
  event_type: string;
  occurred_at: string;
  command_id: string | null;
  causation_event_id: string | null;
  correlation_id: string | null;
  actor_kind: string;
  payload_json: string;
  metadata_json: string;
}

/** Persisted event — adds `sequence` (autoincrement) to UnstoredEvent. */
export interface OrchestrationEvent {
  sequence: number;
  event_id: string;
  aggregate_kind: string;
  stream_id: string;
  stream_version: number;
  event_type: string;
  occurred_at: string;
  command_id: string | null;
  payload_json: string;
  metadata_json: string;
}

/**
 * Append-only event log. Port of rust-backend/src/persistence/event_store.rs.
 * Uses a single SQLite transaction per batch so the autoincrement `sequence`
 * values stay monotonic and the backlog is crash-safe.
 */
export class EventStore {
  private readonly insertStmt;
  private readonly readFromStmt;
  private readonly readOrchestrationFromStmt;
  private readonly readUnprojectedProviderRuntimeStmt;
  private readonly readByEventIdStmt;
  private readonly readProviderRuntimeByStreamVersionStmt;
  private readonly readByCommandStmt;
  private readonly latestStreamVersionStmt;
  private readonly deleteProviderRuntimeBeforeStmt;
  private readonly providerRuntimeRetentionCutoffStmt;
  private readonly deleteProjectedProviderRuntimeUpToStmt;
  private readonly appendTransaction;
  private readonly pruneTransaction;

  constructor(db: Db) {
    this.insertStmt = db.prepare(`
      INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type,
         occurred_at, command_id, causation_event_id, correlation_id,
         actor_kind, payload_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.readFromStmt = db.prepare(`
      SELECT sequence, event_id, aggregate_kind, stream_id, stream_version,
             event_type, occurred_at, command_id, payload_json, metadata_json
      FROM orchestration_events
      WHERE sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `);
    this.readOrchestrationFromStmt = db.prepare(`
      SELECT sequence, event_id, aggregate_kind, stream_id, stream_version,
             event_type, occurred_at, command_id, payload_json, metadata_json
      FROM orchestration_events
      WHERE sequence > ? AND aggregate_kind <> 'provider_runtime'
      ORDER BY sequence ASC
      LIMIT ?
    `);
    this.readUnprojectedProviderRuntimeStmt = db.prepare(`
      SELECT e.sequence, e.event_id, e.aggregate_kind, e.stream_id,
             e.stream_version, e.event_type, e.occurred_at, e.command_id,
             e.payload_json, e.metadata_json
      FROM orchestration_events e
      LEFT JOIN provider_runtime_projection_receipts r
        ON r.event_sequence = e.sequence
      WHERE e.aggregate_kind = 'provider_runtime'
        AND r.event_sequence IS NULL
      ORDER BY e.sequence ASC
      LIMIT ?
    `);
    this.readByEventIdStmt = db.prepare(`
      SELECT sequence, event_id, aggregate_kind, stream_id, stream_version,
             event_type, occurred_at, command_id, payload_json, metadata_json
      FROM orchestration_events
      WHERE event_id = ?
    `);
    this.readProviderRuntimeByStreamVersionStmt = db.prepare(`
      SELECT sequence, event_id, aggregate_kind, stream_id, stream_version,
             event_type, occurred_at, command_id, payload_json, metadata_json
      FROM orchestration_events
      WHERE aggregate_kind = 'provider_runtime'
        AND stream_id = ?
        AND stream_version = ?
      ORDER BY sequence ASC
    `);
    // CR1: idempotent dispatch lookup. Backed by idx_events_command_id (v13).
    this.readByCommandStmt = db.prepare(`
      SELECT sequence, event_id, aggregate_kind, stream_id, stream_version,
             event_type, occurred_at, command_id, payload_json, metadata_json
      FROM orchestration_events
      WHERE command_id = ?
      ORDER BY sequence ASC
    `);
    this.latestStreamVersionStmt = db.prepare(`
      SELECT MAX(stream_version) AS stream_version
      FROM orchestration_events
      WHERE aggregate_kind = ? AND stream_id = ?
    `);
    this.deleteProviderRuntimeBeforeStmt = db.prepare(`
      DELETE FROM orchestration_events
      WHERE aggregate_kind = 'provider_runtime'
        AND occurred_at < ?
        AND EXISTS (
          SELECT 1
          FROM provider_runtime_projection_receipts r
          WHERE r.event_sequence = orchestration_events.sequence
        )
    `);
    // Count-based retention is driven from the receipts table rather than
    // the event log: a receipt exists exactly for the projected
    // provider_runtime events (it cascades away with its event), so its
    // INTEGER PRIMARY KEY walked backwards *is* the "newest N projected
    // events" set. The old shape scanned the whole log by rowid and probed
    // receipts once per row; this touches only the rows it deletes plus the
    // OFFSET it keeps.
    this.providerRuntimeRetentionCutoffStmt = db.prepare(`
      SELECT event_sequence
      FROM provider_runtime_projection_receipts
      ORDER BY event_sequence DESC
      LIMIT 1 OFFSET ?
    `);
    // `+aggregate_kind` keeps the planner off idx_events_provider_stream: on
    // a database whose statistics still describe an empty log it would
    // otherwise scan that partial index with a bloom filter instead of
    // probing the rowid list from the receipts range.
    this.deleteProjectedProviderRuntimeUpToStmt = db.prepare(`
      DELETE FROM orchestration_events
      WHERE +aggregate_kind = 'provider_runtime'
        AND sequence IN (
          SELECT event_sequence
          FROM provider_runtime_projection_receipts
          WHERE event_sequence <= ?
        )
    `);
    this.appendTransaction = db.transaction((batch: UnstoredEvent[]) =>
      this.appendBatch(batch)
    );
    this.pruneTransaction = db.transaction(
      (olderThan: string, maxEvents: number) => {
        const expired = this.deleteProviderRuntimeBeforeStmt.run(olderThan);
        const cutoff = this.providerRuntimeRetentionCutoffStmt.get(maxEvents) as
          | { event_sequence: number }
          | undefined;
        const overflow = cutoff
          ? this.deleteProjectedProviderRuntimeUpToStmt.run(cutoff.event_sequence)
          : { changes: 0 };
        return expired.changes + overflow.changes;
      }
    );
  }

  /** Persists a batch of events atomically; returns them with their assigned sequences. */
  append(events: UnstoredEvent[]): OrchestrationEvent[] {
    return this.appendTransaction(events);
  }

  private appendBatch(batch: UnstoredEvent[]): OrchestrationEvent[] {
    const stored: OrchestrationEvent[] = [];
    for (const e of batch) {
      const info = this.insertStmt.run(
        e.event_id,
        e.aggregate_kind,
        e.stream_id,
        e.stream_version,
        e.event_type,
        e.occurred_at,
        e.command_id,
        e.causation_event_id,
        e.correlation_id,
        e.actor_kind,
        e.payload_json,
        e.metadata_json
      );
      // SQLite rowid is 64-bit. The default driver mode still returns a
      // number beyond the safe range; safe-integer mode returns a bigint.
      // Reject either representation before committing a lossy sequence.
      const rowid = info.lastInsertRowid;
      if (!Number.isSafeInteger(Number(rowid))) {
        throw new Error(
          `Event sequence ${rowid} exceeds Number.MAX_SAFE_INTEGER — refusing to truncate`
        );
      }
      stored.push({
        sequence: Number(rowid),
        event_id: e.event_id,
        aggregate_kind: e.aggregate_kind,
        stream_id: e.stream_id,
        stream_version: e.stream_version,
        event_type: e.event_type,
        occurred_at: e.occurred_at,
        command_id: e.command_id,
        payload_json: e.payload_json,
        metadata_json: e.metadata_json,
      });
    }
    return stored;
  }

  readFromSequence(afterSequence: number, limit: number): OrchestrationEvent[] {
    return this.readFromStmt.all(afterSequence, limit) as OrchestrationEvent[];
  }

  readOrchestrationFromSequence(
    afterSequence: number,
    limit: number
  ): OrchestrationEvent[] {
    return this.readOrchestrationFromStmt.all(
      afterSequence,
      limit
    ) as OrchestrationEvent[];
  }

  readUnprojectedProviderRuntimeEvents(limit: number): OrchestrationEvent[] {
    const boundedLimit = Math.max(1, Math.floor(limit));
    return this.readUnprojectedProviderRuntimeStmt.all(
      boundedLimit
    ) as OrchestrationEvent[];
  }

  readByEventId(eventId: string): OrchestrationEvent | null {
    return (
      (this.readByEventIdStmt.get(eventId) as OrchestrationEvent | undefined) ??
      null
    );
  }

  readProviderRuntimeByStreamVersion(
    streamId: string,
    streamVersion: number
  ): OrchestrationEvent[] {
    return this.readProviderRuntimeByStreamVersionStmt.all(
      streamId,
      streamVersion
    ) as OrchestrationEvent[];
  }

  /**
   * Returns every event the supplied command_id produced, in append order.
   * Used by the orchestration engine to satisfy idempotent retries: if the
   * same command_id is dispatched twice (renderer reconnect, transient
   * network failure, browser flush), the second call returns the events the
   * first call produced rather than throwing.
   */
  readByCommandId(commandId: string): OrchestrationEvent[] {
    return this.readByCommandStmt.all(commandId) as OrchestrationEvent[];
  }

  latestStreamVersion(aggregateKind: string, streamId: string): number {
    const row = this.latestStreamVersionStmt.get(aggregateKind, streamId) as
      | { stream_version: number | null }
      | undefined;
    return typeof row?.stream_version === "number"
      ? row.stream_version
      : 0;
  }

  pruneProviderRuntimeEvents(input: {
    readonly olderThan: string;
    readonly maxEvents: number;
  }): number {
    const maxEvents = Math.max(0, Math.floor(input.maxEvents));
    return this.pruneTransaction(input.olderThan, maxEvents);
  }
}
