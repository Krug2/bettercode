import type { Db } from "../../persistence/db"
import type {
  PendingSourceProposedPlanImplementationStore as PendingStorePort,
  SourceProposedPlanImplementationInput,
} from "./ProviderRuntimeIngestion"

interface PendingLookup {
  readonly implementationThreadId: string
  readonly providerKind?: string | null
  readonly providerInstanceId?: string | null
  readonly acceptedTurnId?: string | null
}

interface PendingRow {
  readonly implementation_thread_id: string
  readonly source_thread_id: string
  readonly source_plan_id: string
  readonly provider_kind: string
  readonly provider_instance_id: string | null
  readonly accepted_turn_id: string
}

export class SqlitePendingSourceProposedPlanImplementationStore implements PendingStorePort {
  private readonly upsertStmt
  private readonly getStmt
  private readonly deleteStmt
  private readonly deleteAllStmt

  constructor(db: Db) {
    this.upsertStmt = db.prepare(`
      INSERT INTO pending_source_proposed_plan_implementations (
        implementation_thread_id,
        source_thread_id,
        source_plan_id,
        provider_kind,
        provider_instance_id,
        accepted_turn_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(implementation_thread_id) DO UPDATE SET
        source_thread_id = excluded.source_thread_id,
        source_plan_id = excluded.source_plan_id,
        provider_kind = excluded.provider_kind,
        provider_instance_id = excluded.provider_instance_id,
        accepted_turn_id = excluded.accepted_turn_id,
        updated_at = excluded.updated_at
    `)
    this.getStmt = db.prepare(`
      SELECT
        implementation_thread_id,
        source_thread_id,
        source_plan_id,
        provider_kind,
        provider_instance_id,
        accepted_turn_id
      FROM pending_source_proposed_plan_implementations
      WHERE implementation_thread_id = ?
      LIMIT 1
    `)
    this.deleteStmt = db.prepare(`
      DELETE FROM pending_source_proposed_plan_implementations
      WHERE implementation_thread_id = ?
    `)
    this.deleteAllStmt = db.prepare(`
      DELETE FROM pending_source_proposed_plan_implementations
    `)
  }

  recordPending(input: SourceProposedPlanImplementationInput): void {
    const now = new Date().toISOString()
    this.upsertStmt.run(
      input.implementationThreadId,
      input.sourceProposedPlan.threadId,
      input.sourceProposedPlan.planId,
      input.providerKind,
      input.providerInstanceId ?? null,
      input.acceptedTurnId,
      now,
      now
    )
  }

  peekPending(input: PendingLookup): SourceProposedPlanImplementationInput | null {
    if (!input.acceptedTurnId) return null
    const pending = this.read(input.implementationThreadId)
    return pending && matches(pending, input, true) ? pending : null
  }

  ackPending(input: PendingLookup): void {
    this.clearPending(input)
  }

  clearPending(input: PendingLookup): void {
    const pending = this.read(input.implementationThreadId)
    if (!pending || !matches(pending, input, false)) return
    this.deleteStmt.run(input.implementationThreadId)
  }

  clearAll(): number {
    return this.deleteAllStmt.run().changes
  }

  private read(
    implementationThreadId: string
  ): SourceProposedPlanImplementationInput | null {
    const row = this.getStmt.get(implementationThreadId) as
      | PendingRow
      | undefined
    if (!row) return null
    return {
      sourceProposedPlan: {
        threadId: row.source_thread_id,
        planId: row.source_plan_id,
      },
      implementationThreadId: row.implementation_thread_id,
      providerKind: row.provider_kind,
      providerInstanceId: row.provider_instance_id,
      acceptedTurnId: row.accepted_turn_id,
    }
  }
}

function matches(
  pending: SourceProposedPlanImplementationInput,
  input: PendingLookup,
  requireAcceptedTurnId: boolean
): boolean {
  if (
    (requireAcceptedTurnId && !input.acceptedTurnId) ||
    (input.acceptedTurnId && pending.acceptedTurnId !== input.acceptedTurnId)
  ) {
    return false
  }
  if (
    input.providerKind &&
    providerKindKey(pending.providerKind) !== providerKindKey(input.providerKind)
  ) {
    return false
  }
  if (
    pending.providerInstanceId &&
    input.providerInstanceId &&
    pending.providerInstanceId !== input.providerInstanceId
  ) {
    return false
  }
  return !pending.providerInstanceId || Boolean(input.providerInstanceId)
}

function providerKindKey(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "")
  switch (key) {
    case "codexcli":
      return "codex_cli"
    case "claudeagent":
    case "claudecli":
      return "claude"
    case "anthropiccli":
      return "anthropic_cli"
    default:
      return key
  }
}
