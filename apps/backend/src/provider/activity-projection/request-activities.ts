import type { ThreadActivityProjection } from "../../persistence/projections"
import {
  makeActivity,
} from "./shared"

/**
 * Activities the chat route writes itself when it answers a provider request
 * (approval, plan approval, user input) or fails to — not projections of a
 * provider event.
 */
export function makeResolvedRequestActivity(input: {
  threadId: string
  requestId: string
  providerKind: string
  providerInstanceId?: string
  decision: "approve" | "deny" | "answer" | "reject"
  answers?: Record<string, unknown>
  requestKind?: "approval" | "user-input" | "plan-approval"
  sequence: number
}): ThreadActivityProjection {
  const isPlanApproval = input.requestKind === "plan-approval"
  const isUserInput =
    !isPlanApproval &&
    (input.decision === "answer" || input.decision === "reject")
  const kind = isPlanApproval
    ? "plan-approval.resolved"
    : isUserInput
      ? "user-input.resolved"
      : "approval.resolved"
  return makeActivity({
    eventType: "request_resolved",
    threadId: input.threadId,
    kind,
    tone: isPlanApproval
      ? "info"
      : input.decision === "deny" || input.decision === "reject"
        ? "error"
        : "info",
    summary: isPlanApproval
      ? input.decision === "approve"
        ? "Plan approved"
        : "Plan sent back for changes"
      : input.decision === "answer"
        ? "User input answered"
        : input.decision === "reject"
          ? "User input rejected"
        : input.decision === "deny"
          ? "Approval denied"
          : "Approval approved",
    payload: {
      providerKind:
        input.providerKind === "codex_cli" ? "codex" : input.providerKind,
      providerInstanceId: input.providerInstanceId,
      requestId: input.requestId,
      decision: input.decision,
      ...(isPlanApproval ? { requestKind: "plan_approval" } : {}),
      ...(input.answers ? { answers: input.answers } : {}),
    },
    sequence: input.sequence,
    idParts: [input.threadId, kind, input.requestId],
  })
}

export function makeFailedRequestActivity(input: {
  threadId: string
  requestId: string
  providerKind: string
  providerInstanceId?: string
  requestKind: "approval" | "user-input" | "plan-approval"
  detail: string
  sequence: number
}): ThreadActivityProjection {
  const kind =
    input.requestKind === "user-input"
      ? "provider.user-input.respond.failed"
      : "provider.approval.respond.failed"
  const summary =
    input.requestKind === "user-input"
      ? "Provider user input response failed"
      : input.requestKind === "plan-approval"
        ? "Provider plan-approval response failed"
        : "Provider approval response failed"

  return makeActivity({
    eventType: kind,
    threadId: input.threadId,
    kind,
    tone: "error",
    summary,
    payload: {
      providerKind:
        input.providerKind === "codex_cli" ? "codex" : input.providerKind,
      providerInstanceId: input.providerInstanceId,
      requestId: input.requestId,
      detail: input.detail,
    },
    sequence: input.sequence,
    // No sequence: a retried response must upsert the same row, and the
    // renderer's local twin (`failedRequestResponseActivity`) builds the
    // identical id without one.
    idParts: [input.threadId, kind, input.requestId],
  })
}
