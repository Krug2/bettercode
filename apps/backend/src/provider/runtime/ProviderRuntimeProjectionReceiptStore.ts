import type { Db } from "../../persistence/db"
import type { ProviderRuntimeProjectionReceiptStore as ProviderRuntimeProjectionReceiptStorePort } from "./ProviderRuntimeIngestion"

const MAX_DISCARD_ERROR_CHARS = 4_096

export type ProviderRuntimeProjectionReceiptStatus = "projected" | "discarded"

export interface ProviderRuntimeProjectionReceipt {
  readonly eventSequence: number
  readonly status: ProviderRuntimeProjectionReceiptStatus
  readonly error: string | null
  readonly projectedAt: string
}

export class ProviderRuntimeProjectionReceiptStore implements ProviderRuntimeProjectionReceiptStorePort {
  private readonly upsertStmt
  private readonly getStmt
  private readonly upsertAttemptStmt
  private readonly getAttemptStmt
  private readonly noteAttemptErrorStmt
  private readonly deleteAttemptStmt

  constructor(private readonly db: Db) {
    // Startup-replay attempts per journal row live in
    // `provider_runtime_replay_attempts` (migration 50). A row that fails to
    // project on every boot must not boot-loop the backend forever; the
    // replayer counts here and discards the row after a bounded number of
    // tries. The table cascades with its event, so an empty table is always
    // a valid state.
    this.upsertStmt = db.prepare(`
      INSERT INTO provider_runtime_projection_receipts
        (event_sequence, status, error, projected_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(event_sequence) DO UPDATE SET
        status = excluded.status,
        error = excluded.error,
        projected_at = excluded.projected_at
    `)
    this.getStmt = db.prepare(`
      SELECT event_sequence, status, error, projected_at
      FROM provider_runtime_projection_receipts
      WHERE event_sequence = ?
    `)
    this.upsertAttemptStmt = db.prepare(`
      INSERT INTO provider_runtime_replay_attempts
        (event_sequence, attempts, last_error, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(event_sequence) DO UPDATE SET
        attempts = attempts + 1,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
      RETURNING attempts
    `)
    this.noteAttemptErrorStmt = db.prepare(`
      UPDATE provider_runtime_replay_attempts
      SET last_error = ?, updated_at = ?
      WHERE event_sequence = ?
    `)
    this.getAttemptStmt = db.prepare(`
      SELECT attempts FROM provider_runtime_replay_attempts
      WHERE event_sequence = ?
    `)
    this.deleteAttemptStmt = db.prepare(`
      DELETE FROM provider_runtime_replay_attempts WHERE event_sequence = ?
    `)
  }

  markProjected(eventSequence: number): void {
    this.write(eventSequence, "projected", null)
    this.deleteAttemptStmt.run(eventSequence)
  }

  markDiscarded(eventSequence: number, error: string): void {
    this.write(
      eventSequence,
      "discarded",
      error.slice(0, MAX_DISCARD_ERROR_CHARS)
    )
    this.deleteAttemptStmt.run(eventSequence)
  }

  /**
   * Counts one startup-replay attempt and returns the total so far. Called
   * before the row is replayed, so an attempt that crashes the process is
   * still counted; `noteReplayAttemptError` fills in the reason afterwards.
   */
  recordReplayAttempt(eventSequence: number, error: string): number {
    this.assertSequence(eventSequence)
    const row = this.upsertAttemptStmt.get(
      eventSequence,
      error.slice(0, MAX_DISCARD_ERROR_CHARS),
      new Date().toISOString()
    ) as { attempts: number } | undefined
    return row?.attempts ?? 1
  }

  /** Stores why the latest counted attempt failed, without counting again. */
  noteReplayAttemptError(eventSequence: number, error: string): void {
    this.assertSequence(eventSequence)
    this.noteAttemptErrorStmt.run(
      error.slice(0, MAX_DISCARD_ERROR_CHARS),
      new Date().toISOString(),
      eventSequence
    )
  }

  replayAttempts(eventSequence: number): number {
    const row = this.getAttemptStmt.get(eventSequence) as
      | { attempts: number }
      | undefined
    return row?.attempts ?? 0
  }

  get(eventSequence: number): ProviderRuntimeProjectionReceipt | null {
    const row = this.getStmt.get(eventSequence) as
      | {
          event_sequence: number
          status: ProviderRuntimeProjectionReceiptStatus
          error: string | null
          projected_at: string
        }
      | undefined
    return row
      ? {
          eventSequence: row.event_sequence,
          status: row.status,
          error: row.error,
          projectedAt: row.projected_at,
        }
      : null
  }

  private write(
    eventSequence: number,
    status: ProviderRuntimeProjectionReceiptStatus,
    error: string | null
  ): void {
    this.assertSequence(eventSequence)
    this.upsertStmt.run(
      eventSequence,
      status,
      error,
      new Date().toISOString()
    )
  }

  private assertSequence(eventSequence: number): void {
    if (!Number.isSafeInteger(eventSequence) || eventSequence <= 0) {
      throw new Error(
        `Invalid provider runtime event sequence '${eventSequence}'.`
      )
    }
  }
}
