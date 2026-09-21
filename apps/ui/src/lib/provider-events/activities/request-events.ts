/**
 * Approvals, plan approvals and user-input requests with their
 * resolutions.
 *
 * Returns the projected activity, or null when the event is not one of
 * this family's.
 */

import { readString } from "@betterc0de/schema"
import {
  truncateDetail,
  requestKind,
  requestKindFromCanonicalRequestType,
  approvalRequestedSummary,
} from "../payload"
import type { ThreadActivity } from "@/lib/chat-store"
import type { ActivityContext } from "./context"
import { makeActivity, upcomingActivitySequence } from "./shared"

export function projectRequestActivity(
  ctx: ActivityContext
): ThreadActivity | null {
  const { threadId, type, payload, providerKind, providerInstanceId } = ctx

  if (
    type === "plan_approval_requested" ||
    ((type === "request.opened" || type === "tool_approval_requested") &&
      readString(payload, "kind") === "plan_approval")
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    return makeActivity(
      threadId,
      "plan-approval.requested",
      "approval",
      "Plan approval requested",
      { ...payload, providerKind, providerInstanceId, requestId },
      [threadId, "plan-approval.requested", requestId ?? upcomingActivitySequence()]
    )
  }

  if (type === "plan_approval_resolved") {
    const requestId = readString(payload, "requestId", "request_id")
    const decision = readString(payload, "decision") ?? "resolved"
    return makeActivity(
      threadId,
      "plan-approval.resolved",
      // A denied plan means "keep planning" — an expected flow, not an error.
      "info",
      decision === "approve" ? "Plan approved" : "Plan sent back for changes",
      { ...payload, providerKind, providerInstanceId, requestId, decision },
      [threadId, "plan-approval.resolved", requestId ?? upcomingActivitySequence()]
    )
  }

  if (type === "tool_approval_requested" || type === "request.opened") {
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
      requestKind(toolName, input)
    return makeActivity(
      threadId,
      "approval.requested",
      "approval",
      approvalRequestedSummary(canonicalRequestKind, toolName),
      {
        ...payload,
        providerKind,
        providerInstanceId,
        requestId,
        requestKind: approvalKind,
        ...(requestType ? { requestType } : {}),
        toolName,
        ...(detail ? { detail: truncateDetail(detail) } : {}),
      },
      [threadId, "approval.requested", requestId ?? upcomingActivitySequence()]
    )
  }

  if (
    type === "tool_approval_resolved" ||
    type === "request_resolved" ||
    type === "request.resolved"
  ) {
    const requestId = readString(payload, "requestId", "request_id")
    const requestType = readString(payload, "requestType", "request_type")
    if (requestType === "tool_user_input") return null
    const decision = readString(payload, "decision") ?? "resolved"
    const canonicalRequestKind =
      requestKindFromCanonicalRequestType(requestType)
    const approvalKind =
      readString(payload, "requestKind", "request_kind") ??
      canonicalRequestKind ??
      requestKind(requestType, payload.resolution)
    return makeActivity(
      threadId,
      "approval.resolved",
      canonicalRequestKind
        ? "approval"
        : decision === "deny"
          ? "error"
          : "info",
      canonicalRequestKind
        ? "Approval resolved"
        : decision === "deny"
          ? "Approval denied"
          : "Approval approved",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        requestId,
        decision,
        ...(approvalKind ? { requestKind: approvalKind } : {}),
        ...(requestType ? { requestType } : {}),
      },
      [threadId, "approval.resolved", requestId ?? upcomingActivitySequence()]
    )
  }

  if (type === "user_input_requested") {
    const requestId = readString(payload, "requestId", "request_id")
    return makeActivity(
      threadId,
      "user-input.requested",
      "info",
      "User input requested",
      { ...payload, providerKind, providerInstanceId, requestId },
      [threadId, "user-input.requested", requestId ?? upcomingActivitySequence()]
    )
  }

  if (type === "user_input_resolved") {
    const requestId = readString(payload, "requestId", "request_id")
    return makeActivity(
      threadId,
      "user-input.resolved",
      "info",
      "User input answered",
      { ...payload, providerKind, providerInstanceId, requestId },
      [threadId, "user-input.resolved", requestId ?? upcomingActivitySequence()]
    )
  }

  return null
}
