import type { Db } from "../persistence/db"

const ADMISSION_ERROR_MAX_CHARS = 16_384
const ADMISSION_ERROR_TRUNCATION_MARKER =
  "\n… checkpoint admission error truncated …\n"

export interface AllocatedCheckpointTurnSlot {
  readonly slot: number
  readonly turnCount: number
}

export interface CheckpointTurnAdmission {
  readonly threadId: string
  readonly turnKey: string
  readonly turnId: string | null
  readonly dispatchTurnId: string | null
  readonly turnCount: number
  readonly cwd: string
  readonly baseCheckpointRef: string
  readonly checkpointRef: string
  readonly status: "prepared" | "failed"
  readonly lastError: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RecordCheckpointTurnAdmissionInput {
  readonly threadId: string
  readonly turnKey: string
  readonly turnId: string | null
  readonly dispatchTurnId: string | null
  readonly turnCount: number
  readonly cwd: string
  readonly baseCheckpointRef: string
  readonly checkpointRef: string
}

const ADMISSION_COLUMNS = `
  thread_id,
  turn_key,
  turn_id,
  dispatch_turn_id,
  turn_index,
  cwd,
  base_checkpoint_ref,
  checkpoint_ref,
  status,
  last_error,
  created_at,
  updated_at
`

/**
 * Atomically allocates deterministic checkpoint-ref slots per thread.
 *
 * Every statement is prepared once here: `allocate` and the admission
 * methods sit on the per-turn hot path, and better-sqlite3 does not cache
 * prepares — each `db.prepare` re-parses and re-plans the SQL.
 */
export class CheckpointTurnSlotStore {
  private readonly selectNextSlotStmt
  private readonly upsertNextSlotStmt
  private readonly threadExistsStmt
  private readonly deleteSlotStmt
  private readonly firstUnresolvedAdmissionStmt
  private readonly maxTurnIndexStmt
  private readonly insertAdmissionStmt
  private readonly getAdmissionStmt
  private readonly listAdmissionsStmt
  private readonly admissionProjectedStmt
  private readonly deleteAdmissionStmt
  private readonly markAdmissionFailedStmt
  private readonly admissionRefPendingStmt
  private readonly deleteProjectedAdmissionsStmt
  private readonly upsertAllSlotsStmt
  private readonly deleteOrphanSlotsStmt
  private readonly allocateTransaction
  private readonly reconcileThreadTransaction
  private readonly recordAdmissionTransaction
  private readonly completeAdmissionTransaction
  private readonly reconcileAllTransaction

  constructor(db: Db) {
    this.selectNextSlotStmt = db.prepare(`
      SELECT next_slot
      FROM checkpoint_turn_slots
      WHERE thread_id = ?
    `)
    this.upsertNextSlotStmt = db.prepare(`
      INSERT INTO checkpoint_turn_slots(thread_id, next_slot, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        next_slot = excluded.next_slot,
        updated_at = excluded.updated_at
    `)
    this.threadExistsStmt = db.prepare(`
      SELECT 1
      FROM projection_threads
      WHERE thread_id = ?
    `)
    this.deleteSlotStmt = db.prepare(`
      DELETE FROM checkpoint_turn_slots
      WHERE thread_id = ?
    `)
    this.firstUnresolvedAdmissionStmt = db.prepare(`
      SELECT turn_key
      FROM checkpoint_turn_admissions
      WHERE thread_id = ?
      LIMIT 1
    `)
    this.maxTurnIndexStmt = db.prepare(`
      SELECT COALESCE(MAX(turn_index), 0) AS next_slot
      FROM turn_diffs
      WHERE thread_id = ?
    `)
    this.insertAdmissionStmt = db.prepare(`
      INSERT INTO checkpoint_turn_admissions(${ADMISSION_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, ?, ?)
      ON CONFLICT(thread_id, turn_key) DO NOTHING
    `)
    this.getAdmissionStmt = db.prepare(`
      SELECT ${ADMISSION_COLUMNS}
      FROM checkpoint_turn_admissions
      WHERE thread_id = ? AND turn_key = ?
    `)
    this.listAdmissionsStmt = db.prepare(`
      SELECT ${ADMISSION_COLUMNS}
      FROM checkpoint_turn_admissions
      ORDER BY created_at ASC, thread_id ASC, turn_index ASC
    `)
    this.admissionProjectedStmt = db.prepare(`
      SELECT 1
      FROM turn_diffs AS turn
      WHERE turn.thread_id = ?
        AND turn.turn_index = ?
        AND EXISTS (
          SELECT 1
          FROM checkpoint_diffs AS checkpoint
          WHERE checkpoint.thread_id = turn.thread_id
            AND checkpoint.checkpoint_ref = ?
        )
      LIMIT 1
    `)
    this.deleteAdmissionStmt = db.prepare(`
      DELETE FROM checkpoint_turn_admissions
      WHERE thread_id = ? AND turn_key = ?
    `)
    this.markAdmissionFailedStmt = db.prepare(`
      UPDATE checkpoint_turn_admissions
      SET status = 'failed', last_error = ?, updated_at = ?
      WHERE thread_id = ? AND turn_key = ?
    `)
    this.admissionRefPendingStmt = db.prepare(`
      SELECT 1
      FROM checkpoint_turn_admissions
      WHERE base_checkpoint_ref = ? OR checkpoint_ref = ?
      LIMIT 1
    `)
    this.deleteProjectedAdmissionsStmt = db.prepare(`
      DELETE FROM checkpoint_turn_admissions AS admission
      WHERE EXISTS (
        SELECT 1
        FROM turn_diffs AS turn
        WHERE turn.thread_id = admission.thread_id
          AND turn.turn_index = admission.turn_index
      )
        AND EXISTS (
          SELECT 1
          FROM checkpoint_diffs AS checkpoint
          WHERE checkpoint.thread_id = admission.thread_id
            AND checkpoint.checkpoint_ref = admission.checkpoint_ref
        )
    `)
    this.upsertAllSlotsStmt = db.prepare(`
      INSERT INTO checkpoint_turn_slots(thread_id, next_slot, updated_at)
      SELECT
        thread.thread_id,
        MAX(
          COALESCE((
            SELECT MAX(diff.turn_index)
            FROM turn_diffs AS diff
            WHERE diff.thread_id = thread.thread_id
          ), 0),
          COALESCE((
            SELECT MAX(admission.turn_index)
            FROM checkpoint_turn_admissions AS admission
            WHERE admission.thread_id = thread.thread_id
          ), 0)
        ),
        ?
      FROM projection_threads AS thread
      WHERE 1 = 1
      GROUP BY thread.thread_id
      ON CONFLICT(thread_id) DO UPDATE SET
        next_slot = excluded.next_slot,
        updated_at = excluded.updated_at
    `)
    this.deleteOrphanSlotsStmt = db.prepare(`
      DELETE FROM checkpoint_turn_slots
      WHERE NOT EXISTS (
        SELECT 1
        FROM projection_threads AS thread
        WHERE thread.thread_id = checkpoint_turn_slots.thread_id
      )
    `)

    this.allocateTransaction = db.transaction(
      (
        threadId: string,
        explicitTurnIndex?: number
      ): AllocatedCheckpointTurnSlot => {
        const row = this.selectNextSlotStmt.get(threadId) as
          | { next_slot: number }
          | undefined
        const current = Math.max(0, Math.trunc(row?.next_slot ?? 0))
        const explicit =
          typeof explicitTurnIndex === "number" &&
          Number.isSafeInteger(explicitTurnIndex) &&
          explicitTurnIndex > 0
            ? explicitTurnIndex
            : null
        // Native provider ordinals may restart or lag after recovery. They
        // are hints, never authority to reuse an already consumed slot.
        const slot =
          explicit === null ? current : Math.max(current, explicit - 1)
        const nextSlot = slot + 1
        // Each slot owns two distinct numeric Git refs. Reject before the
        // durable allocator advances if JavaScript would round them together.
        if (!Number.isSafeInteger(slot * 2 + 1)) {
          throw new Error("Checkpoint turn slot exceeds the safe integer range.")
        }
        this.upsertNextSlotStmt.run(
          threadId,
          nextSlot,
          new Date().toISOString()
        )
        return { slot, turnCount: slot + 1 }
      }
    )
    this.reconcileThreadTransaction = db.transaction(
      (threadId: string): number => {
        const thread = this.threadExistsStmt.get(threadId)
        if (!thread) {
          this.deleteSlotStmt.run(threadId)
          return 0
        }
        const unresolved = this.firstUnresolvedAdmissionStmt.get(threadId) as
          | { turn_key: string }
          | undefined
        if (unresolved) {
          throw new Error(
            `Cannot reconcile checkpoint slots for thread '${threadId}' while turn '${unresolved.turn_key}' is unresolved.`
          )
        }
        const row = this.maxTurnIndexStmt.get(threadId) as
          | { next_slot: number }
          | undefined
        const nextSlot = Math.max(0, Math.trunc(row?.next_slot ?? 0))
        this.upsertNextSlotStmt.run(
          threadId,
          nextSlot,
          new Date().toISOString()
        )
        return nextSlot
      }
    )
    this.recordAdmissionTransaction = db.transaction(
      (input: RecordCheckpointTurnAdmissionInput): void => {
        if (
          !Number.isSafeInteger(input.turnCount) ||
          input.turnCount <= 0
        ) {
          throw new Error("Checkpoint admission turnCount must be positive.")
        }
        const allocator = this.selectNextSlotStmt.get(input.threadId) as
          | { next_slot: number }
          | undefined
        if (
          !allocator ||
          Math.trunc(allocator.next_slot) < input.turnCount
        ) {
          throw new Error(
            `Checkpoint turn ${input.turnCount} for thread '${input.threadId}' was not durably allocated.`
          )
        }
        const now = new Date().toISOString()
        this.insertAdmissionStmt.run(
          input.threadId,
          input.turnKey,
          input.turnId,
          input.dispatchTurnId,
          input.turnCount,
          input.cwd,
          input.baseCheckpointRef,
          input.checkpointRef,
          now,
          now
        )
        const recorded = this.getAdmission(input.threadId, input.turnKey)
        if (
          !recorded ||
          recorded.turnId !== input.turnId ||
          recorded.dispatchTurnId !== input.dispatchTurnId ||
          recorded.turnCount !== input.turnCount ||
          recorded.cwd !== input.cwd ||
          recorded.baseCheckpointRef !== input.baseCheckpointRef ||
          recorded.checkpointRef !== input.checkpointRef
        ) {
          throw new Error(
            `Checkpoint admission identity conflict for thread '${input.threadId}' and turn '${input.turnKey}'.`
          )
        }
      }
    )
    this.completeAdmissionTransaction = db.transaction(
      (input: {
        readonly threadId: string
        readonly turnKey: string
        readonly turnCount: number
        readonly checkpointRef: string
      }): void => {
        const admission = this.getAdmission(input.threadId, input.turnKey)
        if (!admission) {
          throw new Error(
            `Checkpoint admission for thread '${input.threadId}' and turn '${input.turnKey}' is missing.`
          )
        }
        if (
          admission.turnCount !== input.turnCount ||
          admission.checkpointRef !== input.checkpointRef
        ) {
          throw new Error(
            `Checkpoint admission completion identity mismatch for thread '${input.threadId}' and turn '${input.turnKey}'.`
          )
        }
        const projected = this.admissionProjectedStmt.get(
          input.threadId,
          input.turnCount,
          input.checkpointRef
        )
        if (!projected) {
          throw new Error(
            `Checkpoint turn ${input.turnCount} for thread '${input.threadId}' was not durably projected.`
          )
        }
        const deleted = this.deleteAdmissionStmt.run(
          input.threadId,
          input.turnKey
        )
        if (deleted.changes !== 1) {
          throw new Error(
            `Checkpoint admission for thread '${input.threadId}' changed during completion.`
          )
        }
      }
    )
    this.reconcileAllTransaction = db.transaction((now: string): void => {
      this.deleteProjectedAdmissionsStmt.run()
      this.upsertAllSlotsStmt.run(now)
      this.deleteOrphanSlotsStmt.run()
    })
  }

  allocate(
    threadId: string,
    explicitTurnIndex?: number
  ): AllocatedCheckpointTurnSlot {
    return this.allocateTransaction(threadId, explicitTurnIndex)
  }

  recordAdmission(input: RecordCheckpointTurnAdmissionInput): void {
    this.recordAdmissionTransaction(input)
  }

  completeAdmission(input: {
    readonly threadId: string
    readonly turnKey: string
    readonly turnCount: number
    readonly checkpointRef: string
  }): void {
    this.completeAdmissionTransaction(input)
  }

  markAdmissionFailed(
    threadId: string,
    turnKey: string,
    error: unknown
  ): void {
    const result = this.markAdmissionFailedStmt.run(
      boundedAdmissionError(error),
      new Date().toISOString(),
      threadId,
      turnKey
    )
    if (result.changes !== 1) {
      throw new Error(
        `Checkpoint admission for thread '${threadId}' and turn '${turnKey}' is missing while recording failure.`
      )
    }
  }

  getAdmission(
    threadId: string,
    turnKey: string
  ): CheckpointTurnAdmission | null {
    const row = this.getAdmissionStmt.get(threadId, turnKey) as
      | CheckpointTurnAdmissionRow
      | undefined
    return row ? mapAdmission(row) : null
  }

  listAdmissions(): CheckpointTurnAdmission[] {
    const rows = this.listAdmissionsStmt.all() as CheckpointTurnAdmissionRow[]
    return rows.map(mapAdmission)
  }

  isAdmissionRefPending(checkpointRef: string): boolean {
    return Boolean(
      this.admissionRefPendingStmt.get(checkpointRef, checkpointRef)
    )
  }

  /**
   * Reset one allocator to the durable projection boundary. Safe only while
   * that thread has no admitted checkpoint capture (the reactor guarantees
   * this when it calls the method after a failed/interrupted baseline).
   */
  reconcileThread(threadId: string): number {
    return this.reconcileThreadTransaction(threadId)
  }

  /**
   * No provider work is admitted during startup. Projected admissions are
   * acknowledged, unadmitted reservations are reclaimed, and unresolved
   * admissions remain monotonic until startup recovery captures their diff.
   */
  reconcileAll(): void {
    this.reconcileAllTransaction(new Date().toISOString())
  }
}

function boundedAdmissionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.length <= ADMISSION_ERROR_MAX_CHARS) return message
  const remaining =
    ADMISSION_ERROR_MAX_CHARS - ADMISSION_ERROR_TRUNCATION_MARKER.length
  const headLength = Math.floor(remaining / 2)
  const tailLength = remaining - headLength
  return (
    message.slice(0, headLength) +
    ADMISSION_ERROR_TRUNCATION_MARKER +
    message.slice(-tailLength)
  )
}

interface CheckpointTurnAdmissionRow {
  readonly thread_id: string
  readonly turn_key: string
  readonly turn_id: string | null
  readonly dispatch_turn_id: string | null
  readonly turn_index: number
  readonly cwd: string
  readonly base_checkpoint_ref: string
  readonly checkpoint_ref: string
  readonly status: "prepared" | "failed"
  readonly last_error: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapAdmission(
  row: CheckpointTurnAdmissionRow
): CheckpointTurnAdmission {
  return {
    threadId: row.thread_id,
    turnKey: row.turn_key,
    turnId: row.turn_id,
    dispatchTurnId: row.dispatch_turn_id,
    turnCount: row.turn_index,
    cwd: row.cwd,
    baseCheckpointRef: row.base_checkpoint_ref,
    checkpointRef: row.checkpoint_ref,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
