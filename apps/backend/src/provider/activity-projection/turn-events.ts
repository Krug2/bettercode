import { readString } from "@betterc0de/schema"
import type { ThreadActivityProjection } from "../../persistence/projections"
import type { ProjectionContext } from "./context"
import {
  publicRuntimeDiagnosticPayload,
  payloadTurnId,
  truncateDetail,
  usagePayload,
  proposedPlanIdFromPayload,
  makeActivity,
} from "./shared"

/**
 * Turn boundaries, plans and proposed plans, diffs, persisted files,
 * realtime sessions, checkpoints and runtime diagnostics.
 */
export function projectTurnEvents(
  ctx: ProjectionContext
): ThreadActivityProjection | null {
  const { eventType, threadId, payload, providerKind, providerInstanceId, createdAt, sequence } = ctx

  if (eventType === "files.persisted" || eventType === "files_persisted") {
    const files = Array.isArray(payload.files) ? payload.files : []
    const failed = Array.isArray(payload.failed) ? payload.failed : []
    const count = files.length
    const failedCount = failed.length
    return makeActivity({
      eventType,
      threadId,
      kind: "files.persisted",
      tone: failedCount > 0 ? "error" : "info",
      summary:
        failedCount > 0
          ? `${failedCount} file${failedCount === 1 ? "" : "s"} failed to persist`
          : `${count} file${count === 1 ? "" : "s"} persisted`,
      payload: { ...payload, providerKind, providerInstanceId },
      sequence,
      idParts: [threadId, "files.persisted", sequence],
      createdAt,
    })
  }
  if (
    eventType === "thread.token-usage.updated" ||
    eventType === "thread_token_usage_updated"
  ) {
    const usage = usagePayload(payload)
    if (!usage) return null
    return makeActivity({
      eventType,
      threadId,
      kind: "context-window.updated",
      tone: "info",
      summary: "Context window updated",
      payload: { ...payload, ...usage, providerKind, providerInstanceId },
      sequence,
      idParts: [threadId, "context-window.updated", sequence],
      createdAt,
    })
  }
  if (
    eventType === "thread.state.changed" ||
    eventType === "thread_state_changed"
  ) {
    const state = readString(payload, "state")
    if (state !== "compacted") return null
    return makeActivity({
      eventType,
      threadId,
      kind: "context-compaction",
      tone: "info",
      summary: "Context compacted",
      payload: { ...payload, providerKind, providerInstanceId },
      sequence,
      idParts: [threadId, "context-compaction", sequence],
      createdAt,
    })
  }
  if (eventType === "thread.realtime.started") {
    const realtimeSessionId = readString(
      payload,
      "realtimeSessionId",
      "realtime_session_id"
    )
    return makeActivity({
      eventType,
      threadId,
      kind: "thread.realtime.started",
      tone: "info",
      summary: "Realtime session started",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(realtimeSessionId ? { detail: realtimeSessionId } : {}),
      },
      sequence,
      idParts: [
        threadId,
        "thread.realtime.started",
        realtimeSessionId ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "thread.realtime.error") {
    const message =
      readString(payload, "message", "error") ?? "Realtime error"
    return makeActivity({
      eventType,
      threadId,
      kind: "thread.realtime.error",
      tone: "error",
      summary: message,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        detail: message,
      },
      sequence,
      idParts: [threadId, "thread.realtime.error", sequence],
      createdAt,
    })
  }
  if (eventType === "thread.realtime.closed") {
    const reason = readString(payload, "reason", "message")
    return makeActivity({
      eventType,
      threadId,
      kind: "thread.realtime.closed",
      tone: "info",
      summary: "Realtime session closed",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(reason ? { detail: reason } : {}),
      },
      sequence,
      idParts: [threadId, "thread.realtime.closed", reason ?? sequence],
      createdAt,
    })
  }
  if (eventType === "turn.plan.updated" || eventType === "turn_plan_updated") {
    return makeActivity({
      eventType,
      threadId,
      kind: "turn.plan.updated",
      tone: "info",
      summary: "Plan updated",
      payload: { ...payload, providerKind, providerInstanceId },
      sequence,
      idParts: [
        threadId,
        "turn.plan.updated",
        payloadTurnId(payload) ?? sequence,
      ],
      createdAt,
    })
  }
  if (
    eventType === "turn.proposed.delta" ||
    eventType === "turn_proposed_delta"
  ) {
    const delta = truncateDetail(readString(payload, "delta"))
    return makeActivity({
      eventType,
      threadId,
      kind: "turn.proposed.delta",
      tone: "info",
      summary: "Plan draft updated",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(delta ? { detail: delta } : {}),
      },
      sequence,
      idParts: [threadId, "turn.proposed.delta", sequence],
      createdAt,
    })
  }
  if (
    eventType === "turn.proposed.completed" ||
    eventType === "turn_proposed_completed"
  ) {
    const rawPlanMarkdown = readString(
      payload,
      "planMarkdown",
      "plan_markdown"
    )?.trim()
    if (!rawPlanMarkdown) return null
    const planMarkdown = truncateDetail(rawPlanMarkdown)
    const planId = proposedPlanIdFromPayload(threadId, payload)
    return makeActivity({
      eventType,
      threadId,
      kind: "turn.proposed.completed",
      tone: "info",
      summary: "Plan proposed",
      payload: {
        ...payload,
        ...(planId ? { planId } : {}),
        providerKind,
        providerInstanceId,
        ...(planMarkdown ? { detail: planMarkdown } : {}),
      },
      sequence,
      idParts: [
        threadId,
        "turn.proposed.completed",
        planId ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "turn.diff.updated" || eventType === "turn_diff_updated") {
    const unifiedDiff = readString(
      payload,
      "unifiedDiff",
      "unified_diff",
      "diff"
    )
    return makeActivity({
      eventType,
      threadId,
      kind: "turn.diff.updated",
      tone: "info",
      summary: "Diff updated",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(unifiedDiff ? { detail: truncateDetail(unifiedDiff) } : {}),
      },
      sequence,
      idParts: [
        threadId,
        "turn.diff.updated",
        payloadTurnId(payload) ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "turn_started") {
    return makeActivity({
      eventType,
      threadId,
      kind: "turn.started",
      tone: "thinking",
      summary: "Turn started",
      payload,
      sequence,
      idParts: [threadId, "turn.started", payloadTurnId(payload) ?? sequence],
      createdAt,
    })
  }
  if (eventType === "checkpoint.captured") {
    return makeActivity({
      eventType,
      threadId,
      kind: "checkpoint.captured",
      tone: "info",
      summary: "Checkpoint captured",
      payload,
      sequence,
      idParts: [
        threadId,
        "checkpoint.captured",
        payloadTurnId(payload) ??
          readString(payload, "checkpointRef", "checkpoint_ref") ??
          sequence,
      ],
      createdAt,
    })
  }
  if (
    eventType === "turn_completed" ||
    eventType === "turn_interrupted" ||
    eventType === "turn.aborted"
  ) {
    return makeActivity({
      eventType,
      threadId,
      kind:
        eventType === "turn_interrupted" || eventType === "turn.aborted"
          ? "turn.aborted"
          : "turn.completed",
      tone: "info",
      summary:
        eventType === "turn_interrupted" || eventType === "turn.aborted"
          ? "Turn interrupted"
          : "Turn completed",
      payload,
      sequence,
      idParts: [threadId, eventType, payloadTurnId(payload) ?? sequence],
      createdAt,
    })
  }
  if (eventType === "runtime.error" || eventType === "turn_error") {
    return makeActivity({
      eventType,
      threadId,
      kind: "runtime.error",
      tone: "error",
      summary: "Provider runtime error",
      payload: publicRuntimeDiagnosticPayload(
        payload,
        providerKind,
        providerInstanceId
      ),
      sequence,
      idParts: [
        threadId,
        "runtime.error",
        readString(payload, "eventId", "event_id") ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "runtime.warning" || eventType === "turn_warning") {
    return makeActivity({
      eventType,
      threadId,
      kind: "runtime.warning",
      tone: "info",
      summary: "Provider runtime warning",
      payload: publicRuntimeDiagnosticPayload(
        payload,
        providerKind,
        providerInstanceId
      ),
      sequence,
      idParts: [
        threadId,
        "runtime.warning",
        readString(payload, "eventId", "event_id") ?? sequence,
      ],
      createdAt,
    })
  }

  return null
}
