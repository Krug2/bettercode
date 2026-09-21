import { readString } from "@betterc0de/schema"
import type { ThreadActivityProjection } from "../../persistence/projections"
import type { ProjectionContext } from "./context"
import {
  truncateDetail,
  classifyApprovalRequest,
  requestKindFromCanonicalRequestType,
  approvalRequestedSummary,
  makeActivity,
} from "./shared"

/**
 * Approvals, plan approvals and user-input requests, opened and resolved.
 */
export function projectRequestEvents(
  ctx: ProjectionContext
): ThreadActivityProjection | null {
  const { eventType, threadId, payload, providerKind, providerInstanceId, createdAt, sequence } = ctx

  if (
    eventType === "plan_approval_requested" ||
    ((eventType === "request.opened" ||
      eventType === "tool_approval_requested") &&
      readString(payload, "kind") === "plan_approval")
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    return makeActivity({
      eventType,
      threadId,
      kind: "plan-approval.requested",
      tone: "approval",
      summary: "Plan approval requested",
      payload: { ...payload, providerKind, providerInstanceId, requestId },
      sequence,
      idParts: [threadId, "plan-approval.requested", requestId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "plan_approval_resolved") {
    const requestId = readString(payload, "requestId", "request_id")
    const decision = readString(payload, "decision") ?? "resolved"
    return makeActivity({
      eventType,
      threadId,
      kind: "plan-approval.resolved",
      // A denied plan means "keep planning" — an expected flow, not an error.
      tone: "info",
      summary:
        decision === "approve" ? "Plan approved" : "Plan sent back for changes",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        requestId,
        decision,
      },
      sequence,
      idParts: [threadId, "plan-approval.resolved", requestId ?? sequence],
      createdAt,
    })
  }
  if (
    eventType === "tool_approval_requested" ||
    eventType === "request.opened"
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    const requestType = readString(payload, "requestType", "request_type")
    if (requestType === "tool_user_input") return null
    const detail = readString(payload, "detail")
    const canonicalRequestKind =
      requestKindFromCanonicalRequestType(requestType)
    const toolName =
      readString(payload, "tool", "tool_name", "toolName") ??
      requestType ??
      undefined
    const input = payload.input ?? payload.args
    const approvalKind =
      readString(payload, "requestKind", "request_kind") ??
      canonicalRequestKind ??
      classifyApprovalRequest(toolName, input)
    return makeActivity({
      eventType,
      threadId,
      kind: "approval.requested",
      tone: "approval",
      summary: approvalRequestedSummary(canonicalRequestKind, toolName),
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        requestId,
        requestKind: approvalKind,
        ...(requestType ? { requestType } : {}),
        toolName,
        ...(detail ? { detail: truncateDetail(detail) } : {}),
      },
      sequence,
      idParts: [threadId, "approval.requested", requestId ?? sequence],
      createdAt,
    })
  }
  if (
    eventType === "tool_approval_resolved" ||
    eventType === "request_resolved" ||
    eventType === "request.resolved"
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    const requestType = readString(payload, "requestType", "request_type")
    if (requestType === "tool_user_input") return null
    const decision = readString(payload, "decision") ?? "resolved"
    const canonicalRequestKind =
      requestKindFromCanonicalRequestType(requestType)
    const requestKind =
      readString(payload, "requestKind", "request_kind") ??
      canonicalRequestKind ??
      classifyApprovalRequest(requestType, payload.resolution)
    return makeActivity({
      eventType,
      threadId,
      kind: "approval.resolved",
      tone: canonicalRequestKind
        ? "approval"
        : decision === "deny"
          ? "error"
          : "info",
      summary: canonicalRequestKind
        ? "Approval resolved"
        : decision === "deny"
          ? "Approval denied"
          : "Approval approved",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        requestId,
        decision,
        ...(requestKind ? { requestKind } : {}),
        ...(requestType ? { requestType } : {}),
      },
      sequence,
      idParts: [threadId, "approval.resolved", requestId ?? sequence],
      createdAt,
    })
  }
  if (
    eventType === "user_input_requested" ||
    eventType === "user-input.requested"
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    return makeActivity({
      eventType,
      threadId,
      kind: "user-input.requested",
      tone: "info",
      summary: "User input requested",
      payload: { ...payload, providerKind, providerInstanceId, requestId },
      sequence,
      idParts: [threadId, "user-input.requested", requestId ?? sequence],
      createdAt,
    })
  }
  if (
    eventType === "user_input_resolved" ||
    eventType === "user-input.resolved"
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    return makeActivity({
      eventType,
      threadId,
      kind: "user-input.resolved",
      tone: "info",
      summary: "User input answered",
      payload: { ...payload, providerKind, providerInstanceId, requestId },
      sequence,
      idParts: [threadId, "user-input.resolved", requestId ?? sequence],
      createdAt,
    })
  }

  return null
}
