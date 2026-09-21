import { isRecord } from "@betterc0de/schema"
import type { Db } from "../persistence/db"
import { HttpError } from "../http/errors"
import type { ProviderKind } from "../provider/runtime/contracts"
import { logger } from "../observability/logger"
import {
  resolveWorkspaceRecoveryScopes,
  workspaceRecoveryScopesConflict,
} from "./workspace-recovery-gate"

export type CheckpointRevertPhase =
  | "prepared"
  | "filesystem_restored"
  | "provider_rollback_started"
  | "provider_rollback_done"
  | "database_truncated"

// A revert materializes at most two deterministic refs per turn. Keep corrupt
// counters from causing unbounded synchronous work; larger histories need a
// persisted, batched cleanup cursor rather than a partially applied revert.
export const MAX_CHECKPOINT_REVERT_TURN_RANGE = 100_000
const MAX_CHECKPOINT_PAIRED_TURN_COUNT = Math.ceil(Number.MAX_SAFE_INTEGER / 2)

export function assertCheckpointRevertTurnRange(turnCount: number, currentTurnCount: number): void {
  if (
    !Number.isSafeInteger(turnCount) || turnCount < 0 ||
    !Number.isSafeInteger(currentTurnCount) || currentTurnCount < turnCount ||
    currentTurnCount > MAX_CHECKPOINT_PAIRED_TURN_COUNT ||
    currentTurnCount - turnCount > MAX_CHECKPOINT_REVERT_TURN_RANGE
  ) {
    throw new HttpError(409, "Checkpoint turn range is invalid or exceeds the bounded recovery limit.", "checkpoint_turn_range_invalid")
  }
}

export interface CheckpointRevertOperation {
  readonly threadId: string
  readonly turnCount: number
  readonly currentTurnCount: number
  readonly updatedAt: string
  readonly cwd: string
  readonly providerKind: ProviderKind
  readonly providerInstanceId: string
  readonly targetCheckpointRef: string
  readonly currentCheckpointRef: string | null
  readonly staleCheckpointRefs: readonly string[]
  readonly preserveFuture: boolean
  readonly phase: CheckpointRevertPhase
}

interface OperationRow {
  thread_id: string
  phase: string
  payload_json: string
}

export interface CheckpointRevertQuarantineRecord {
  readonly quarantineId: number
  readonly threadId: string
  readonly phase: string
  readonly payloadJson: string
  readonly error: string
  readonly quarantinedAt: string
}

export class CheckpointRevertOperationStore {
  // Prepared once: `get`/`hasRecoveryRequired` guard every thread
  // mutation route, and better-sqlite3 re-plans SQL on each db.prepare.
  private readonly insertOperationStmt
  private readonly getOperationStmt
  private readonly listOperationsStmt
  private readonly setPhaseStmt
  private readonly deleteOperationStmt
  private readonly recoveryRequiredStmt
  private readonly blockingThreadsStmt
  private readonly listQuarantinedByThreadStmt
  private readonly listQuarantinedStmt
  private readonly deleteQuarantineStmt
  private readonly clearRecoveryRequiredStmt
  private readonly insertQuarantineStmt
  private readonly markRecoveryRequiredStmt
  private readonly resolveQuarantineTransaction
  private readonly quarantineTransaction

  constructor(db: Db) {
    this.insertOperationStmt = db.prepare(`
      INSERT INTO checkpoint_revert_operations
        (thread_id, phase, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.getOperationStmt = db.prepare(`
      SELECT thread_id, phase, payload_json
      FROM checkpoint_revert_operations
      WHERE thread_id = ?
    `)
    this.listOperationsStmt = db.prepare(`
      SELECT thread_id, phase, payload_json
      FROM checkpoint_revert_operations
      ORDER BY created_at ASC
    `)
    this.setPhaseStmt = db.prepare(`
      UPDATE checkpoint_revert_operations
      SET phase = ?, updated_at = ?
      WHERE thread_id = ?
    `)
    this.deleteOperationStmt = db.prepare(
      "DELETE FROM checkpoint_revert_operations WHERE thread_id = ?"
    )
    this.recoveryRequiredStmt = db.prepare(`
      SELECT
        COALESCE(
          (
            SELECT recovery_required
            FROM projection_threads
            WHERE thread_id = ?
          ),
          0
        ) AS recovery_required,
        EXISTS(
          SELECT 1
          FROM checkpoint_revert_quarantine
          WHERE thread_id = ?
        ) AS has_quarantine
    `)
    this.blockingThreadsStmt = db.prepare(`
      SELECT thread_id, project_path, worktree_path
      FROM projection_threads
      WHERE recovery_required = 1
         OR thread_id IN (
           SELECT thread_id
           FROM checkpoint_revert_operations
         )
    `)
    const quarantineColumns = `
      SELECT quarantine_id, thread_id, phase, payload_json, error,
             quarantined_at
      FROM checkpoint_revert_quarantine
    `
    this.listQuarantinedByThreadStmt = db.prepare(`
      ${quarantineColumns}
      WHERE thread_id = ?
      ORDER BY quarantined_at DESC, quarantine_id DESC
    `)
    this.listQuarantinedStmt = db.prepare(`
      ${quarantineColumns}
      ORDER BY quarantined_at DESC, quarantine_id DESC
    `)
    this.deleteQuarantineStmt = db.prepare(
      "DELETE FROM checkpoint_revert_quarantine WHERE thread_id = ?"
    )
    this.clearRecoveryRequiredStmt = db.prepare(`
      UPDATE projection_threads
      SET recovery_required = 0, updated_at = ?
      WHERE thread_id = ?
    `)
    this.insertQuarantineStmt = db.prepare(`
      INSERT INTO checkpoint_revert_quarantine
        (thread_id, phase, payload_json, error, quarantined_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.markRecoveryRequiredStmt = db.prepare(`
      UPDATE projection_threads
      SET recovery_required = 1, updated_at = ?
      WHERE thread_id = ?
    `)
    this.resolveQuarantineTransaction = db.transaction((threadId: string) => {
      this.deleteQuarantineStmt.run(threadId)
      this.clearRecoveryRequiredStmt.run(new Date().toISOString(), threadId)
    })
    this.quarantineTransaction = db.transaction(
      (row: OperationRow, detail: string) => {
        const now = new Date().toISOString()
        this.insertQuarantineStmt.run(
          row.thread_id,
          row.phase,
          row.payload_json,
          detail,
          now
        )
        this.deleteOperationStmt.run(row.thread_id)
        this.markRecoveryRequiredStmt.run(now, row.thread_id)
      }
    )
  }

  begin(
    input: Omit<CheckpointRevertOperation, "phase">
  ): CheckpointRevertOperation {
    assertCheckpointRevertTurnRange(input.turnCount, input.currentTurnCount)
    const existing = this.get(input.threadId)
    if (existing) {
      if (existing.turnCount !== input.turnCount) {
        throw new HttpError(
          409,
          `Thread '${input.threadId}' already has a pending checkpoint revert.`
        )
      }
      return existing
    }
    if (this.hasRecoveryRequired(input.threadId)) {
      throw new HttpError(
        409,
        `Thread '${input.threadId}' requires checkpoint recovery before another revert can begin.`,
        "checkpoint_recovery_required"
      )
    }
    const operation: CheckpointRevertOperation = {
      ...input,
      phase: "prepared",
    }
    const now = new Date().toISOString()
    this.insertOperationStmt.run(
      input.threadId,
      operation.phase,
      JSON.stringify(input),
      now,
      now
    )
    return operation
  }

  get(threadId: string): CheckpointRevertOperation | null {
    const row = this.getOperationStmt.get(threadId) as
      | OperationRow
      | undefined
    if (!row) return null
    try {
      return operationFromRow(row)
    } catch (error) {
      this.quarantine(row, error)
      return null
    }
  }

  list(): CheckpointRevertOperation[] {
    const rows = this.listOperationsStmt.all() as OperationRow[]
    const operations: CheckpointRevertOperation[] = []
    for (const row of rows) {
      try {
        operations.push(operationFromRow(row))
      } catch (err) {
        this.quarantine(row, err)
        logger.error(
          { err, thread: row.thread_id, phase: row.phase },
          "invalid checkpoint revert journal row skipped during recovery"
        )
      }
    }
    return operations
  }

  setPhase(
    operation: CheckpointRevertOperation,
    phase: CheckpointRevertPhase
  ): CheckpointRevertOperation {
    this.setPhaseStmt.run(phase, new Date().toISOString(), operation.threadId)
    return { ...operation, phase }
  }

  delete(threadId: string): void {
    this.deleteOperationStmt.run(threadId)
  }

  hasRecoveryRequired(threadId: string): boolean {
    const row = this.recoveryRequiredStmt.get(threadId, threadId) as
      | { recovery_required: number; has_quarantine: number }
      | undefined
    return row?.recovery_required === 1 || row?.has_quarantine === 1
  }

  hasBlockingRecovery(threadId: string): boolean {
    if (this.hasRecoveryRequired(threadId)) return true
    return this.get(threadId) !== null || this.hasRecoveryRequired(threadId)
  }

  blockingThreadForCwd(cwd: string): string | null {
    const targetScopes = resolveWorkspaceRecoveryScopes(cwd)
    for (const operation of this.list()) {
      if (
        workspaceRecoveryScopesConflict(
          resolveWorkspaceRecoveryScopes(operation.cwd),
          targetScopes
        )
      ) {
        return operation.threadId
      }
    }
    const rows = this.blockingThreadsStmt.all() as Array<{
      thread_id: string
      project_path: string | null
      worktree_path: string | null
    }>
    for (const row of rows) {
      if (
        [row.project_path, row.worktree_path].some(
          (candidate) =>
            typeof candidate === "string" &&
            candidate.length > 0 &&
            workspaceRecoveryScopesConflict(
              resolveWorkspaceRecoveryScopes(candidate),
              targetScopes
            )
        )
      ) {
        return row.thread_id
      }
    }
    return null
  }

  listQuarantined(threadId?: string): CheckpointRevertQuarantineRecord[] {
    const rows = (
      threadId
        ? this.listQuarantinedByThreadStmt.all(threadId)
        : this.listQuarantinedStmt.all()
    ) as Array<{
      quarantine_id: number
      thread_id: string
      phase: string
      payload_json: string
      error: string
      quarantined_at: string
    }>
    return rows.map((row) => ({
      quarantineId: row.quarantine_id,
      threadId: row.thread_id,
      phase: row.phase,
      payloadJson: row.payload_json,
      error: row.error,
      quarantinedAt: row.quarantined_at,
    }))
  }

  resolveQuarantine(threadId: string): void {
    this.resolveQuarantineTransaction(threadId)
  }

  private quarantine(row: OperationRow, error: unknown): void {
    const detail = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 16 * 1024)
    this.quarantineTransaction(row, detail)
  }
}

function operationFromRow(row: OperationRow): CheckpointRevertOperation {
  const parsed: unknown = JSON.parse(row.payload_json)
  if (!isCheckpointRevertPhase(row.phase) || !isRecord(parsed)) {
    throw new Error(
      `Invalid checkpoint revert journal row for '${row.thread_id}'.`
    )
  }
  const threadId = requiredString(parsed.threadId, "threadId", 1_024)
  const turnCount = requiredNonnegativeInteger(parsed.turnCount, "turnCount")
  const currentTurnCount = requiredNonnegativeInteger(
    parsed.currentTurnCount,
    "currentTurnCount"
  )
  assertCheckpointRevertTurnRange(turnCount, currentTurnCount)
  const currentCheckpointRef =
    parsed.currentCheckpointRef === null
      ? null
      : requiredString(
          parsed.currentCheckpointRef,
          "currentCheckpointRef",
          1_024
        )
  if (
    threadId !== row.thread_id ||
    currentTurnCount < turnCount ||
    !Array.isArray(parsed.staleCheckpointRefs) ||
    parsed.staleCheckpointRefs.length > 10_000 ||
    typeof parsed.preserveFuture !== "boolean"
  ) {
    throw new Error(
      `Invalid checkpoint revert journal row for '${row.thread_id}'.`
    )
  }
  const staleCheckpointRefs = parsed.staleCheckpointRefs.map((value) =>
    requiredString(value, "staleCheckpointRefs", 1_024)
  )
  return {
    threadId,
    turnCount,
    currentTurnCount,
    updatedAt: requiredString(parsed.updatedAt, "updatedAt", 128),
    cwd: requiredString(parsed.cwd, "cwd", 32_768),
    providerKind: requiredString(
      parsed.providerKind,
      "providerKind",
      128
    ) as ProviderKind,
    providerInstanceId: requiredString(
      parsed.providerInstanceId,
      "providerInstanceId",
      1_024
    ),
    targetCheckpointRef: requiredString(
      parsed.targetCheckpointRef,
      "targetCheckpointRef",
      1_024
    ),
    currentCheckpointRef,
    staleCheckpointRefs,
    preserveFuture: parsed.preserveFuture,
    phase: row.phase,
  }
}

function isCheckpointRevertPhase(
  value: string
): value is CheckpointRevertPhase {
  return [
    "prepared",
    "filesystem_restored",
    "provider_rollback_started",
    "provider_rollback_done",
    "database_truncated",
  ].includes(value)
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Invalid checkpoint revert journal field '${field}'.`)
  }
  return value
}

function requiredNonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid checkpoint revert journal field '${field}'.`)
  }
  return value as number
}
