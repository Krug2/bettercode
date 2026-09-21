import { randomUUID } from "node:crypto"
import type { Db } from "../persistence/db"

export interface CheckpointRefCleanupIntent {
  readonly cwd: string
  readonly checkpointRef: string
  readonly intentId: string
}

export interface CheckpointRefCleanupEntry {
  readonly cwd: string
  readonly checkpointRef: string
  readonly intentId: string
  readonly threadId: string
  readonly attempts: number
  readonly lastError: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RetainedCheckpointBaseline {
  readonly threadId: string
  readonly cwd: string
  readonly checkpointRef: string
  readonly createdAt: string
}

const CLEANUP_COLUMNS = `
  queue.cwd, queue.checkpoint_ref, queue.intent_id,
  queue.thread_id, queue.attempts, queue.last_error,
  queue.created_at, queue.updated_at
`

/**
 * Durable queue of checkpoint refs awaiting deletion. Statements are
 * prepared once: the scheduler polls this store continuously, so a
 * `db.prepare` per call would re-plan the same SQL on every tick.
 */
export class CheckpointRefCleanupStore {
  private readonly enqueueStmt
  private readonly completeIntentStmt
  private readonly completeRefStmt
  private readonly recordIntentFailureStmt
  private readonly insertBaselineStmt
  private readonly getBaselineStmt
  private readonly getStmt
  private readonly isReferencedStmt
  private readonly listStmt
  private readonly listBatchFreshStmt
  private readonly listBatchEligibleStmt
  private readonly enqueueTransaction
  private readonly completeTransaction
  private readonly retainBaselineTransaction

  constructor(db: Db) {
    this.enqueueStmt = db.prepare(`
      INSERT INTO checkpoint_ref_cleanup_queue
        (cwd, checkpoint_ref, thread_id, attempts, last_error, created_at,
         updated_at, intent_id)
      VALUES (?, ?, ?, 0, NULL, ?, ?, ?)
      ON CONFLICT(cwd, checkpoint_ref) DO UPDATE SET
        thread_id = excluded.thread_id,
        attempts = 0,
        last_error = NULL,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        intent_id = excluded.intent_id
    `)
    this.completeIntentStmt = db.prepare(`
      DELETE FROM checkpoint_ref_cleanup_queue
      WHERE cwd = ? AND checkpoint_ref = ? AND intent_id = ?
    `)
    this.completeRefStmt = db.prepare(`
      DELETE FROM checkpoint_ref_cleanup_queue
      WHERE cwd = ? AND checkpoint_ref = ?
    `)
    this.recordIntentFailureStmt = db.prepare(`
      UPDATE checkpoint_ref_cleanup_queue
      SET attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE cwd = ? AND checkpoint_ref = ? AND intent_id = ?
    `)
    this.insertBaselineStmt = db.prepare(`
      INSERT INTO checkpoint_baselines(
        thread_id,
        cwd,
        checkpoint_ref,
        created_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO NOTHING
    `)
    this.getBaselineStmt = db.prepare(`
      SELECT thread_id, cwd, checkpoint_ref, created_at
      FROM checkpoint_baselines
      WHERE thread_id = ?
    `)
    this.getStmt = db.prepare(`
      SELECT ${CLEANUP_COLUMNS}
      FROM checkpoint_ref_cleanup_queue AS queue
      WHERE queue.cwd = ? AND queue.checkpoint_ref = ?
    `)
    this.isReferencedStmt = db.prepare(`
      SELECT 1
      FROM (
        SELECT checkpoint_ref
        FROM checkpoint_diffs
        WHERE checkpoint_ref = ?
        UNION ALL
        SELECT checkpoint_ref
        FROM checkpoint_baselines
        WHERE checkpoint_ref = ?
      )
      LIMIT 1
    `)
    this.listStmt = db.prepare(`
      SELECT ${CLEANUP_COLUMNS}
      FROM checkpoint_ref_cleanup_queue AS queue
      ORDER BY queue.updated_at ASC, queue.cwd ASC, queue.checkpoint_ref ASC
      LIMIT ?
    `)
    const listBatchSql = (eligibility: string) => `
      SELECT ${CLEANUP_COLUMNS}
      FROM checkpoint_ref_cleanup_queue AS queue
      WHERE queue.created_at <= ?
        AND ${eligibility}
        AND (
          ? IS NULL
          OR queue.created_at > ?
          OR (
            queue.created_at = ? AND queue.cwd > ?
          )
          OR (
            queue.created_at = ? AND queue.cwd = ?
            AND queue.checkpoint_ref > ?
          )
        )
      ORDER BY queue.created_at ASC, queue.cwd ASC, queue.checkpoint_ref ASC
      LIMIT ?
    `
    this.listBatchFreshStmt = db.prepare(listBatchSql("1 = 1"))
    this.listBatchEligibleStmt = db.prepare(
      listBatchSql(`(
        queue.attempts > 0 OR EXISTS(
          SELECT 1
          FROM checkpoint_diffs AS diff
          WHERE diff.checkpoint_ref = queue.checkpoint_ref
        ) OR EXISTS(
          SELECT 1
          FROM checkpoint_baselines AS baseline
          WHERE baseline.checkpoint_ref = queue.checkpoint_ref
        )
      )`)
    )

    this.enqueueTransaction = db.transaction(
      (input: {
        threadId: string
        cwd: string
        checkpointRefs: readonly string[]
      }): CheckpointRefCleanupIntent[] => {
        const now = new Date().toISOString()
        const intents: CheckpointRefCleanupIntent[] = []
        for (const checkpointRef of new Set(input.checkpointRefs)) {
          const intentId = randomUUID()
          this.enqueueStmt.run(
            input.cwd,
            checkpointRef,
            input.threadId,
            now,
            now,
            intentId
          )
          intents.push({ cwd: input.cwd, checkpointRef, intentId })
        }
        return intents
      }
    )
    this.completeTransaction = db.transaction(
      (cwd: string, checkpointRefs: readonly string[]): void => {
        for (const checkpointRef of new Set(checkpointRefs)) {
          this.completeRefStmt.run(cwd, checkpointRef)
        }
      }
    )
    this.retainBaselineTransaction = db.transaction(
      (input: {
        threadId: string
        cwd: string
        checkpointRef: string
      }): RetainedCheckpointBaseline => {
        this.insertBaselineStmt.run(
          input.threadId,
          input.cwd,
          input.checkpointRef,
          new Date().toISOString()
        )
        const retained = this.getBaseline(input.threadId)
        if (!retained) {
          throw new Error(
            `Failed to retain checkpoint baseline for thread '${input.threadId}'.`
          )
        }
        if (
          retained.cwd !== input.cwd ||
          retained.checkpointRef !== input.checkpointRef
        ) {
          throw new Error(
            `Thread '${input.threadId}' already has a different retained checkpoint baseline.`
          )
        }
        return retained
      }
    )
  }

  enqueue(input: {
    threadId: string
    cwd: string
    checkpointRefs: readonly string[]
  }): CheckpointRefCleanupIntent[] {
    return this.enqueueTransaction(input)
  }

  completeIntent(intent: CheckpointRefCleanupIntent): boolean {
    const result = this.completeIntentStmt.run(
      intent.cwd,
      intent.checkpointRef,
      intent.intentId
    )
    return result.changes > 0
  }

  recordIntentFailure(
    intent: CheckpointRefCleanupIntent,
    error: unknown
  ): boolean {
    const result = this.recordIntentFailureStmt.run(
      (error instanceof Error ? error.message : String(error)).slice(0, 16_384),
      new Date().toISOString(),
      intent.cwd,
      intent.checkpointRef,
      intent.intentId
    )
    return result.changes > 0
  }

  /**
   * Compatibility helper for callers that do not retain an enqueue
   * generation: acknowledging "whatever the current generation is" inside
   * one transaction is the same as reading it first and then deleting by
   * intent id, without the per-ref read and without a window between the
   * two statements.
   */
  complete(cwd: string, checkpointRefs: readonly string[]): void {
    this.completeTransaction(cwd, checkpointRefs)
  }

  /**
   * Resolves the current generation first, so a delayed worker can never
   * mutate a replacement intent.
   */
  recordFailure(cwd: string, checkpointRef: string, error: unknown): void {
    const current = this.get(cwd, checkpointRef)
    if (current) this.recordIntentFailure(current, error)
  }

  /**
   * The pre-first-turn checkpoint is the only durable representation of
   * turn-count zero. Keep it referenced until the owning thread is removed.
   */
  retainBaseline(input: {
    threadId: string
    cwd: string
    checkpointRef: string
  }): RetainedCheckpointBaseline {
    return this.retainBaselineTransaction(input)
  }

  getBaseline(threadId: string): RetainedCheckpointBaseline | null {
    const row = this.getBaselineStmt.get(threadId) as BaselineRow | undefined
    return row
      ? {
          threadId: row.thread_id,
          cwd: row.cwd,
          checkpointRef: row.checkpoint_ref,
          createdAt: row.created_at,
        }
      : null
  }

  get(
    cwd: string,
    checkpointRef: string
  ): CheckpointRefCleanupEntry | null {
    const row = this.getStmt.get(cwd, checkpointRef) as CleanupRow | undefined
    return row ? mapRow(row) : null
  }

  isReferenced(checkpointRef: string): boolean {
    return Boolean(this.isReferencedStmt.get(checkpointRef, checkpointRef))
  }

  list(limit = 128): CheckpointRefCleanupEntry[] {
    const rows = this.listStmt.all(
      Math.min(512, Math.max(1, Math.floor(limit)))
    ) as CleanupRow[]
    return rows.map(mapRow)
  }

  listBatch(input: {
    readonly includeFresh: boolean
    readonly createdBefore: string
    readonly after?: {
      readonly createdAt: string
      readonly cwd: string
      readonly checkpointRef: string
    }
    readonly limit?: number
  }): CheckpointRefCleanupEntry[] {
    const limit = Math.min(512, Math.max(1, Math.floor(input.limit ?? 128)))
    const statement = input.includeFresh
      ? this.listBatchFreshStmt
      : this.listBatchEligibleStmt
    const after = input.after
    const rows = statement.all(
      input.createdBefore,
      after?.createdAt ?? null,
      after?.createdAt ?? "",
      after?.createdAt ?? "",
      after?.cwd ?? "",
      after?.createdAt ?? "",
      after?.cwd ?? "",
      after?.checkpointRef ?? "",
      limit
    ) as CleanupRow[]
    return rows.map(mapRow)
  }
}

interface CleanupRow {
  cwd: string
  checkpoint_ref: string
  intent_id: string
  thread_id: string
  attempts: number
  last_error: string | null
  created_at: string
  updated_at: string
}

interface BaselineRow {
  thread_id: string
  cwd: string
  checkpoint_ref: string
  created_at: string
}

function mapRow(row: CleanupRow): CheckpointRefCleanupEntry {
  return {
    cwd: row.cwd,
    checkpointRef: row.checkpoint_ref,
    intentId: row.intent_id,
    threadId: row.thread_id,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
