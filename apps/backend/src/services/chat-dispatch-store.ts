import { createHash } from "node:crypto"
import type { Db } from "../persistence/db"
import type { ProviderSessionBindingStore } from "../provider/runtime/ProviderSessionBindingStore"

export type ChatDispatchStatus =
  | "pending"
  | "accepted"
  | "completed"
  | "failed"
  | "uncertain"
  | "reverted"

export interface ChatDispatchRecord {
  readonly dispatchId: string
  readonly threadId: string
  readonly messageId: string
  readonly providerKind: string
  readonly providerInstanceId: string | null
  readonly requestFingerprint: string
  readonly status: ChatDispatchStatus
  readonly providerTurnId: string | null
  readonly attemptCount: number
  readonly lastError: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly acceptedAt: string | null
  readonly completedAt: string | null
  readonly failedAt: string | null
  readonly recoveryCompletedAt: string | null
}

export interface ChatDispatchReservation {
  readonly dispatchId: string
  readonly threadId: string
  readonly messageId: string
  readonly providerKind: string
  readonly providerInstanceId: string | null
  readonly requestFingerprint: string
}

export type ChatDispatchReservationResult =
  | { readonly kind: "created"; readonly record: ChatDispatchRecord }
  | { readonly kind: "existing"; readonly record: ChatDispatchRecord }

interface ChatDispatchRow {
  readonly dispatch_id: string
  readonly thread_id: string
  readonly message_id: string
  readonly provider_kind: string
  readonly provider_instance_id: string | null
  readonly request_fingerprint: string
  readonly status: string
  readonly provider_turn_id: string | null
  readonly attempt_count: number
  readonly last_error: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly accepted_at: string | null
  readonly completed_at: string | null
  readonly failed_at: string | null
  readonly recovery_completed_at: string | null
}

export class ChatDispatchConflictError extends Error {
  readonly statusCode = 409
  readonly code = "dispatch_id_conflict"

  constructor(readonly dispatchId: string) {
    super(`Dispatch id '${dispatchId}' is already bound to a different request.`)
    this.name = "ChatDispatchConflictError"
  }
}

export class ChatDispatchTransitionError extends Error {
  constructor(
    readonly dispatchId: string,
    readonly fromStatus: ChatDispatchStatus | "missing",
    readonly toStatus: ChatDispatchStatus
  ) {
    super(
      `Cannot transition dispatch '${dispatchId}' from '${fromStatus}' to '${toStatus}'.`
    )
    this.name = "ChatDispatchTransitionError"
  }
}

export class ChatDispatchStore {
  private readonly getStmt
  private readonly getByProviderTurnStmt
  private readonly getActiveForThreadStmt
  private readonly insertStmt
  private readonly bindProviderTurnStmt
  private readonly markAcceptedStmt
  private readonly markCompletedStmt
  private readonly markFailedStmt
  private readonly markIncompleteUncertainStmt
  private readonly listIncompleteRecoveryStmt
  private readonly completeRecoveryStmt
  private readonly getMessageContentStmt
  private readonly updateMessageContentStmt
  private readonly reserveTransaction
  private readonly acceptTransaction
  private readonly failTransaction
  private readonly recoverTransaction

  constructor(
    private readonly db: Db,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.getStmt = db.prepare(`
      SELECT * FROM chat_dispatches WHERE dispatch_id = ? LIMIT 1
    `)
    this.getByProviderTurnStmt = db.prepare(`
      SELECT *
      FROM chat_dispatches
      WHERE thread_id = ?
        AND provider_instance_id IS ?
        AND provider_turn_id = ?
      LIMIT 1
    `)
    this.getActiveForThreadStmt = db.prepare(`
      SELECT *
      FROM chat_dispatches
      WHERE thread_id = ? AND status IN ('pending', 'accepted')
      ORDER BY created_at DESC, dispatch_id DESC
      LIMIT 1
    `)
    this.insertStmt = db.prepare(`
      INSERT INTO chat_dispatches
        (dispatch_id, thread_id, message_id, provider_kind,
         provider_instance_id, request_fingerprint, status, provider_turn_id,
         attempt_count, last_error, created_at, updated_at, accepted_at,
         completed_at, failed_at, recovery_completed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, 1, NULL, ?, ?, NULL, NULL, NULL, NULL)
    `)
    this.bindProviderTurnStmt = db.prepare(`
      UPDATE chat_dispatches
      SET provider_turn_id = ?,
          provider_instance_id = COALESCE(provider_instance_id, ?),
          updated_at = ?
      WHERE dispatch_id = ?
        AND status = 'pending'
        AND (provider_instance_id IS NULL OR provider_instance_id IS ?)
        AND (provider_turn_id IS NULL OR provider_turn_id = ?)
    `)
    this.markCompletedStmt = db.prepare(`
      UPDATE chat_dispatches
      SET status = 'completed',
          provider_turn_id = ?,
          provider_instance_id = COALESCE(provider_instance_id, ?),
          last_error = NULL,
          accepted_at = COALESCE(accepted_at, ?),
          completed_at = COALESCE(completed_at, ?),
          updated_at = ?,
          recovery_completed_at = NULL
      WHERE dispatch_id = ?
        AND (provider_instance_id IS NULL OR provider_instance_id IS ?)
        AND status IN ('pending', 'accepted', 'uncertain')
    `)
    this.markAcceptedStmt = db.prepare(`
      UPDATE chat_dispatches
      SET status = 'accepted',
          provider_turn_id = ?,
          provider_instance_id = COALESCE(provider_instance_id, ?),
          last_error = NULL,
          accepted_at = COALESCE(accepted_at, ?),
          updated_at = ?,
          recovery_completed_at = NULL
      WHERE dispatch_id = ?
        AND (provider_instance_id IS NULL OR provider_instance_id IS ?)
        AND status = 'pending'
    `)
    this.markFailedStmt = db.prepare(`
      UPDATE chat_dispatches
      SET status = 'failed',
          last_error = ?,
          failed_at = COALESCE(failed_at, ?),
          updated_at = ?,
          recovery_completed_at = NULL
      WHERE dispatch_id = ? AND status IN ('pending', 'accepted', 'uncertain')
    `)
    this.markIncompleteUncertainStmt = db.prepare(`
      UPDATE chat_dispatches
      SET status = 'uncertain',
          last_error = COALESCE(
            last_error,
            'Backend restarted before the provider dispatch reached a durable terminal state.'
          ),
          updated_at = ?,
          recovery_completed_at = NULL
      WHERE status IN ('pending', 'accepted')
    `)
    this.listIncompleteRecoveryStmt = db.prepare(`
      SELECT *
      FROM chat_dispatches
      WHERE status = 'uncertain' AND recovery_completed_at IS NULL
      ORDER BY created_at ASC, dispatch_id ASC
    `)
    this.completeRecoveryStmt = db.prepare(`
      UPDATE chat_dispatches
      SET recovery_completed_at = ?, updated_at = ?
      WHERE dispatch_id = ?
        AND status = 'uncertain'
        AND recovery_completed_at IS NULL
    `)
    this.getMessageContentStmt = db.prepare(`
      SELECT role, content_json
      FROM projection_messages
      WHERE thread_id = ? AND message_id = ?
      LIMIT 1
    `)
    this.updateMessageContentStmt = db.prepare(`
      UPDATE projection_messages
      SET content_json = ?
      WHERE thread_id = ? AND message_id = ? AND role = 'user'
    `)

    this.reserveTransaction = db.transaction(
      (
        input: ChatDispatchReservation,
        persistUserMessage: () => void
      ): ChatDispatchReservationResult => {
        const existing = this.get(input.dispatchId)
        if (existing) {
          this.assertSameRequest(existing, input)
          return { kind: "existing", record: existing }
        }

        persistUserMessage()
        const timestamp = this.now()
        this.insertStmt.run(
          input.dispatchId,
          input.threadId,
          input.messageId,
          input.providerKind,
          input.providerInstanceId,
          input.requestFingerprint,
          timestamp,
          timestamp
        )
        this.writeMessageLifecycle(input.threadId, input.messageId, "pending")
        return { kind: "created", record: this.require(input.dispatchId) }
      }
    )

    this.acceptTransaction = db.transaction(
      (
        dispatchId: string,
        providerTurnId: string,
        providerInstanceId: string | null
      ): ChatDispatchRecord => {
        const existing = this.get(dispatchId)
        if (!existing) {
          throw new ChatDispatchTransitionError(
            dispatchId,
            "missing",
            "accepted"
          )
        }
        if (
          existing.providerTurnId !== null &&
          existing.providerTurnId !== providerTurnId
        ) {
          throw new ChatDispatchTransitionError(
            dispatchId,
            existing.status,
            "accepted"
          )
        }
        if (existing.status === "accepted") {
          if (
            existing.providerTurnId !== providerTurnId ||
            !providerInstanceMatches(existing, providerInstanceId)
          ) {
            throw new ChatDispatchTransitionError(
              dispatchId,
              existing.status,
              "accepted"
            )
          }
          return existing
        }
        if (
          (existing.status === "completed" || existing.status === "failed") &&
          existing.providerTurnId === providerTurnId &&
          providerInstanceMatches(existing, providerInstanceId)
        ) {
          return existing
        }
        if (existing.status !== "pending") {
          throw new ChatDispatchTransitionError(
            dispatchId,
            existing.status,
            "accepted"
          )
        }
        const timestamp = this.now()
        const result = this.markAcceptedStmt.run(
          providerTurnId,
          providerInstanceId,
          timestamp,
          timestamp,
          dispatchId,
          providerInstanceId
        ) as { changes: number }
        if (result.changes !== 1) {
          throw new ChatDispatchTransitionError(
            dispatchId,
            existing.status,
            "accepted"
          )
        }
        this.writeMessageLifecycle(
          existing.threadId,
          existing.messageId,
          "accepted"
        )
        return this.require(dispatchId)
      }
    )

    this.failTransaction = db.transaction(
      (dispatchId: string, error: unknown): ChatDispatchRecord => {
        const existing = this.get(dispatchId)
        if (!existing) {
          throw new ChatDispatchTransitionError(dispatchId, "missing", "failed")
        }
        if (
          existing.status === "completed" ||
          existing.status === "failed" ||
          existing.status === "reverted"
        ) {
          return existing
        }
        if (
          existing.status !== "pending" &&
          existing.status !== "accepted" &&
          existing.status !== "uncertain"
        ) {
          throw new ChatDispatchTransitionError(
            dispatchId,
            existing.status,
            "failed"
          )
        }
        const timestamp = this.now()
        const result = this.markFailedStmt.run(
          errorDetail(error),
          timestamp,
          timestamp,
          dispatchId
        ) as { changes: number }
        if (result.changes !== 1) {
          throw new ChatDispatchTransitionError(
            dispatchId,
            existing.status,
            "failed"
          )
        }
        this.writeMessageLifecycle(
          existing.threadId,
          existing.messageId,
          "failed"
        )
        return this.require(dispatchId)
      }
    )

    this.recoverTransaction = db.transaction((): ChatDispatchRecord[] => {
      const timestamp = this.now()
      this.markIncompleteUncertainStmt.run(timestamp)
      const rows = this.listIncompleteRecoveryStmt.all() as ChatDispatchRow[]
      const records = rows.map(recordFromRow)
      for (const record of records) {
        this.writeMessageLifecycle(
          record.threadId,
          record.messageId,
          "uncertain"
        )
      }
      return records
    })
  }

  get(dispatchId: string): ChatDispatchRecord | null {
    const row = this.getStmt.get(dispatchId) as ChatDispatchRow | undefined
    return row ? recordFromRow(row) : null
  }

  getByProviderTurn(
    threadId: string,
    providerInstanceId: string | null,
    providerTurnId: string
  ): ChatDispatchRecord | null {
    const row = this.getByProviderTurnStmt.get(
      threadId,
      providerInstanceId,
      providerTurnId
    ) as ChatDispatchRow | undefined
    return row ? recordFromRow(row) : null
  }

  hasProviderTurn(
    threadId: string,
    providerInstanceId: string | null,
    providerTurnId: string
  ): boolean {
    return (
      this.getByProviderTurn(threadId, providerInstanceId, providerTurnId) !==
      null
    )
  }

  getActiveForThread(threadId: string): ChatDispatchRecord | null {
    const row = this.getActiveForThreadStmt.get(threadId) as
      | ChatDispatchRow
      | undefined
    return row ? recordFromRow(row) : null
  }

  bindProviderTurn(input: {
    readonly dispatchId: string
    readonly providerTurnId: string
    readonly providerInstanceId?: string | null
  }): ChatDispatchRecord {
    if (!input.providerTurnId.trim()) {
      throw new ChatDispatchTransitionError(
        input.dispatchId,
        this.get(input.dispatchId)?.status ?? "missing",
        "pending"
      )
    }
    const transaction = this.db.transaction((): ChatDispatchRecord => {
      const existing = this.get(input.dispatchId)
      if (!existing) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          "missing",
          "pending"
        )
      }
      if (!providerInstanceMatches(existing, input.providerInstanceId ?? null)) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "pending"
        )
      }
      if (
        existing.providerTurnId === input.providerTurnId &&
        (existing.status === "pending" ||
          existing.status === "accepted" ||
          existing.status === "completed" ||
          existing.status === "failed")
      ) {
        return existing
      }
      if (existing.status !== "pending" || existing.providerTurnId !== null) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "pending"
        )
      }
      const timestamp = this.now()
      const result = this.bindProviderTurnStmt.run(
        input.providerTurnId,
        input.providerInstanceId ?? null,
        timestamp,
        input.dispatchId,
        input.providerInstanceId ?? null,
        input.providerTurnId
      ) as { changes: number }
      if (result.changes !== 1) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "pending"
        )
      }
      return this.require(input.dispatchId)
    })
    return transaction()
  }

  markCompletedByProviderTurn(
    threadId: string,
    providerInstanceId: string | null,
    providerTurnId: string
  ): ChatDispatchRecord | null {
    const existing = this.getByProviderTurn(
      threadId,
      providerInstanceId,
      providerTurnId
    )
    if (!existing) return null
    return this.markCompleted({
      dispatchId: existing.dispatchId,
      providerTurnId,
      providerInstanceId,
    })
  }

  markFailedByProviderTurn(
    threadId: string,
    providerInstanceId: string | null,
    providerTurnId: string,
    error: unknown
  ): ChatDispatchRecord | null {
    const existing = this.getByProviderTurn(
      threadId,
      providerInstanceId,
      providerTurnId
    )
    if (!existing) return null
    return this.markFailed(existing.dispatchId, error)
  }

  reserve(
    input: ChatDispatchReservation,
    persistUserMessage: () => void
  ): ChatDispatchReservationResult {
    if (input.dispatchId !== input.messageId) {
      throw new ChatDispatchConflictError(input.dispatchId)
    }
    return this.reserveTransaction(input, persistUserMessage)
  }

  assertSameRequest(
    existing: ChatDispatchRecord,
    input: ChatDispatchReservation
  ): void {
    if (
      existing.threadId !== input.threadId ||
      existing.messageId !== input.messageId ||
      existing.providerKind !== input.providerKind ||
      existing.requestFingerprint !== input.requestFingerprint
    ) {
      throw new ChatDispatchConflictError(input.dispatchId)
    }
  }

  markAccepted(input: {
    readonly dispatchId: string
    readonly providerTurnId: string
    readonly providerInstanceId?: string | null
  }): ChatDispatchRecord {
    if (!input.providerTurnId.trim()) {
      throw new ChatDispatchTransitionError(
        input.dispatchId,
        this.get(input.dispatchId)?.status ?? "missing",
        "accepted"
      )
    }
    return this.acceptTransaction(
      input.dispatchId,
      input.providerTurnId,
      input.providerInstanceId ?? null
    )
  }

  markFailed(dispatchId: string, error: unknown): ChatDispatchRecord {
    return this.failTransaction(dispatchId, error)
  }

  markCompleted(input: {
    readonly dispatchId: string
    readonly providerTurnId: string
    readonly providerInstanceId?: string | null
  }): ChatDispatchRecord {
    if (!input.providerTurnId.trim()) {
      throw new ChatDispatchTransitionError(
        input.dispatchId,
        this.get(input.dispatchId)?.status ?? "missing",
        "completed"
      )
    }
    const transaction = this.db.transaction((): ChatDispatchRecord => {
      const existing = this.get(input.dispatchId)
      if (!existing) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          "missing",
          "completed"
        )
      }
      if (
        existing.providerTurnId !== null &&
        existing.providerTurnId !== input.providerTurnId
      ) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "completed"
        )
      }
      if (existing.status === "completed") {
        if (
          existing.providerTurnId !== input.providerTurnId ||
          !providerInstanceMatches(
            existing,
            input.providerInstanceId ?? null
          )
        ) {
          throw new ChatDispatchTransitionError(
            input.dispatchId,
            existing.status,
            "completed"
          )
        }
        return existing
      }
      if (
        (existing.status === "failed" || existing.status === "reverted") &&
        existing.providerTurnId === input.providerTurnId &&
        providerInstanceMatches(existing, input.providerInstanceId ?? null)
      ) {
        return existing
      }
      if (
        existing.status === "uncertain" &&
        (existing.providerTurnId !== input.providerTurnId ||
          !providerInstanceMatches(
            existing,
            input.providerInstanceId ?? null
          ))
      ) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "completed"
        )
      }
      if (
        existing.status !== "pending" &&
        existing.status !== "accepted" &&
        existing.status !== "uncertain"
      ) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "completed"
        )
      }
      const timestamp = this.now()
      const result = this.markCompletedStmt.run(
        input.providerTurnId,
        input.providerInstanceId ?? null,
        timestamp,
        timestamp,
        timestamp,
        input.dispatchId,
        input.providerInstanceId ?? null
      ) as { changes: number }
      if (result.changes !== 1) {
        throw new ChatDispatchTransitionError(
          input.dispatchId,
          existing.status,
          "completed"
        )
      }
      this.writeMessageLifecycle(
        existing.threadId,
        existing.messageId,
        "completed"
      )
      return this.require(input.dispatchId)
    })
    return transaction()
  }

  recoverPendingAfterRestart(): ChatDispatchRecord[] {
    return this.recoverTransaction()
  }

  completeRecovery(dispatchId: string): void {
    const timestamp = this.now()
    const result = this.completeRecoveryStmt.run(
      timestamp,
      timestamp,
      dispatchId
    ) as { changes: number }
    if (result.changes !== 1) {
      const existing = this.get(dispatchId)
      if (
        existing?.status === "uncertain" &&
        existing.recoveryCompletedAt !== null
      ) {
        return
      }
      throw new ChatDispatchTransitionError(
        dispatchId,
        existing?.status ?? "missing",
        "uncertain"
      )
    }
  }

  private require(dispatchId: string): ChatDispatchRecord {
    const record = this.get(dispatchId)
    if (!record) {
      throw new Error(`Dispatch '${dispatchId}' disappeared during a transaction.`)
    }
    return record
  }

  private writeMessageLifecycle(
    threadId: string,
    messageId: string,
    status: ChatDispatchStatus
  ): void {
    const row = this.getMessageContentStmt.get(threadId, messageId) as
      | { role: string; content_json: string }
      | undefined
    if (!row || row.role !== "user") return
    const parsed = parseMessageContent(row.content_json)
    const content = JSON.stringify({
      ...parsed,
      extra: mergeChatDispatchMetadata(parsed.extra, status),
    })
    this.updateMessageContentStmt.run(content, threadId, messageId)
  }
}

export function chatDispatchFingerprint(payload: unknown): string {
  const canonical = JSON.stringify(canonicalJsonValue(payload))
  return createHash("sha256").update(canonical).digest("hex")
}

export function mergeChatDispatchMetadata(
  extra: Record<string, unknown>,
  status: ChatDispatchStatus
): Record<string, unknown> {
  const next = { ...extra }
  delete next.dispatchFailed
  delete next.dispatchStatus
  next.dispatchStatus = status
  if (
    status === "failed" ||
    status === "uncertain" ||
    status === "reverted"
  ) {
    next.dispatchFailed = true
  }
  return next
}

export function recoverChatDispatchesAfterRestart(
  dispatches: ChatDispatchStore,
  bindings: ProviderSessionBindingStore
): ChatDispatchRecord[] {
  const records = dispatches.recoverPendingAfterRestart()
  for (const record of records) {
    const binding = record.providerInstanceId
      ? bindings.get(record.threadId, record.providerInstanceId)
      : bindings
          .list()
          .filter(
            (candidate) =>
              candidate.threadId === record.threadId &&
              candidate.providerKind === record.providerKind
          )
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    if (binding) {
      bindings.rotateGeneration(record.threadId, binding.providerInstanceId)
    }
    dispatches.completeRecovery(record.dispatchId)
  }
  return records
}

function providerInstanceMatches(
  record: ChatDispatchRecord,
  providerInstanceId: string | null
): boolean {
  return (
    record.providerInstanceId === null ||
    record.providerInstanceId === providerInstanceId
  )
}

function recordFromRow(row: ChatDispatchRow): ChatDispatchRecord {
  return {
    dispatchId: row.dispatch_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    providerKind: row.provider_kind,
    providerInstanceId: row.provider_instance_id,
    requestFingerprint: row.request_fingerprint,
    status: parseStatus(row.status),
    providerTurnId: row.provider_turn_id,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    recoveryCompletedAt: row.recovery_completed_at,
  }
}

function parseStatus(raw: string): ChatDispatchStatus {
  switch (raw) {
    case "pending":
    case "accepted":
    case "completed":
    case "failed":
    case "uncertain":
    case "reverted":
      return raw
    default:
      throw new Error(`Unknown chat dispatch status '${raw}'.`)
  }
}

function parseMessageContent(raw: string): {
  readonly text: string
  readonly extra: Record<string, unknown>
} {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { text: "", extra: {} }
    }
    const record = value as Record<string, unknown>
    return {
      text: typeof record.text === "string" ? record.text : "",
      extra:
        record.extra &&
        typeof record.extra === "object" &&
        !Array.isArray(record.extra)
          ? (record.extra as Record<string, unknown>)
          : {},
    }
  } catch {
    return { text: "", extra: {} }
  }
}

function canonicalJsonValue(
  value: unknown,
  seen: Set<object> = new Set()
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Cannot fingerprint cyclic input.")
    seen.add(value)
    const result = value.map((item) => canonicalJsonValue(item, seen))
    seen.delete(value)
    return result
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>
    if (seen.has(object)) throw new TypeError("Cannot fingerprint cyclic input.")
    seen.add(object)
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(object).sort()) {
      const item = object[key]
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        continue
      }
      result[key] = canonicalJsonValue(item, seen)
    }
    seen.delete(object)
    return result
  }
  return null
}

function errorDetail(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "string"
        ? error
        : safeJson(error)
  return detail.slice(0, 16 * 1024)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
