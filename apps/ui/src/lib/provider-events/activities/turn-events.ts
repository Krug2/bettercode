/**
 * Turn boundaries, plans, diffs, checkpoints, errors and warnings.
 *
 * Returns the projected activity, or null when the event is not one of
 * this family's.
 */

import { readString } from "@betterc0de/schema"
import {
  payloadTurnId,
  providerKindFromPayload,
  providerInstanceIdFromPayload,
  truncateDetail,
  proposedPlanIdFromPayload,
} from "../payload"
import type { ThreadActivity } from "@/lib/chat-store"
import type { ActivityContext } from "./context"
import { makeActivity, upcomingActivitySequence } from "./shared"

export function projectTurnActivity(
  ctx: ActivityContext
): ThreadActivity | null {
  const { threadId, type, payload, providerKind, providerInstanceId } = ctx

  if (type === "turn.plan.updated" || type === "turn_plan_updated") {
    return makeActivity(
      threadId,
      "turn.plan.updated",
      "info",
      "Plan updated",
      { ...payload, providerKind, providerInstanceId },
      [
        threadId,
        "turn.plan.updated",
        payloadTurnId(payload) ?? upcomingActivitySequence(),
      ]
    )
  }

  if (type === "turn.proposed.delta" || type === "turn_proposed_delta") {
    const delta = truncateDetail(readString(payload, "delta"))
    return makeActivity(
      threadId,
      "turn.proposed.delta",
      "info",
      "Plan draft updated",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(delta ? { detail: delta } : {}),
      },
      [threadId, "turn.proposed.delta", upcomingActivitySequence()]
    )
  }

  if (
    type === "turn.proposed.completed" ||
    type === "turn_proposed_completed"
  ) {
    const planMarkdown = truncateDetail(
      readString(payload, "planMarkdown", "plan_markdown")
    )
    const planId = proposedPlanIdFromPayload(threadId, payload)
    return makeActivity(
      threadId,
      "turn.proposed.completed",
      "info",
      "Plan proposed",
      {
        ...payload,
        ...(planId ? { planId } : {}),
        providerKind,
        providerInstanceId,
        ...(planMarkdown ? { detail: planMarkdown } : {}),
      },
      [threadId, "turn.proposed.completed", planId ?? upcomingActivitySequence()]
    )
  }

  if (type === "turn.diff.updated" || type === "turn_diff_updated") {
    const unifiedDiff = readString(
      payload,
      "unifiedDiff",
      "unified_diff",
      "diff"
    )
    return makeActivity(
      threadId,
      "turn.diff.updated",
      "info",
      "Diff updated",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(unifiedDiff ? { detail: truncateDetail(unifiedDiff) } : {}),
      },
      [
        threadId,
        "turn.diff.updated",
        payloadTurnId(payload) ?? upcomingActivitySequence(),
      ]
    )
  }

  if (type === "checkpoint.captured") {
    return makeActivity(
      threadId,
      "checkpoint.captured",
      "info",
      "Checkpoint captured",
      { ...payload, providerKind, providerInstanceId },
      [
        threadId,
        "checkpoint.captured",
        payloadTurnId(payload) ??
          readString(payload, "checkpointRef", "checkpoint_ref") ??
          upcomingActivitySequence(),
      ]
    )
  }

  if (type === "turn_started") {
    return makeActivity(
      threadId,
      "turn.started",
      "thinking",
      "Turn started",
      payload,
      [threadId, "turn.started", payloadTurnId(payload) ?? upcomingActivitySequence()]
    )
  }

  if (
    type === "turn_completed" ||
    type === "turn_interrupted" ||
    type === "turn.aborted"
  ) {
    return makeActivity(
      threadId,
      type === "turn_interrupted" || type === "turn.aborted"
        ? "turn.aborted"
        : "turn.completed",
      "info",
      type === "turn_interrupted" || type === "turn.aborted"
        ? "Turn interrupted"
        : "Turn completed",
      payload,
      [threadId, type, payloadTurnId(payload) ?? upcomingActivitySequence()]
    )
  }

  if (type === "turn_error") {
    const providerKind = providerKindFromPayload(payload)
    const providerInstanceId = providerInstanceIdFromPayload(payload)
    return makeActivity(
      threadId,
      "runtime.error",
      "error",
      readString(payload, "error", "message") ?? "Provider error",
      { ...payload, providerKind, providerInstanceId },
      [
        threadId,
        "runtime.error",
        readString(payload, "eventId", "event_id") ?? upcomingActivitySequence(),
      ]
    )
  }

  if (type === "turn_warning") {
    const providerKind = providerKindFromPayload(payload)
    const providerInstanceId = providerInstanceIdFromPayload(payload)
    return makeActivity(
      threadId,
      "runtime.warning",
      "info",
      readString(payload, "error", "message") ?? "Provider warning",
      { ...payload, providerKind, providerInstanceId },
      [
        threadId,
        "runtime.warning",
        readString(payload, "eventId", "event_id") ?? upcomingActivitySequence(),
      ]
    )
  }

  return null
}
