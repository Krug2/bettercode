/**
 * Session, auth, model routing, configuration, hooks, tasks, realtime
 * and thread-level notices.
 *
 * Returns the projected activity, or null when the event is not one of
 * this family's.
 */

import { readString } from "@betterc0de/schema"
import { truncateDetail, outputDetail, usagePayload } from "../payload"
import type { ThreadActivity } from "@/lib/chat-store"
import type { ActivityContext } from "./context"
import { makeActivity, upcomingActivitySequence } from "./shared"

export function projectSessionActivity(
  ctx: ActivityContext
): ThreadActivity | null {
  const { threadId, type, payload, providerKind, providerInstanceId } = ctx

  if (type === "session.started" || type === "session_started") {
    const message = truncateDetail(readString(payload, "message"))
    return makeActivity(
      threadId,
      "session.started",
      "info",
      "Provider session started",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(message ? { detail: message } : {}),
      },
      [threadId, "session.started", upcomingActivitySequence()]
    )
  }

  if (type === "session.configured" || type === "session_configured") {
    return makeActivity(
      threadId,
      "session.configured",
      "info",
      "Provider session configured",
      { ...payload, providerKind, providerInstanceId },
      [threadId, "session.configured", upcomingActivitySequence()]
    )
  }

  if (type === "session.state.changed" || type === "session_state_changed") {
    const state = readString(payload, "state", "status") ?? "ready"
    const reason = truncateDetail(readString(payload, "reason", "detail"))
    return makeActivity(
      threadId,
      "session.state.changed",
      state === "error" ? "error" : "info",
      state === "error"
        ? "Provider session error"
        : `Provider session ${state}`,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        state,
        ...(reason ? { detail: reason } : {}),
      },
      [threadId, "session.state.changed", upcomingActivitySequence()]
    )
  }

  if (type === "session.exited" || type === "session_exited") {
    const reason = truncateDetail(readString(payload, "reason"))
    const exitKind = readString(payload, "exitKind", "exit_kind")
    return makeActivity(
      threadId,
      "session.exited",
      exitKind === "error" ? "error" : "info",
      exitKind === "error"
        ? "Provider session exited with error"
        : "Provider session exited",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(reason ? { detail: reason } : {}),
        ...(exitKind ? { exitKind } : {}),
      },
      [threadId, "session.exited", upcomingActivitySequence()]
    )
  }

  if (type === "task.started" || type === "task_started") {
    const taskId = readString(payload, "taskId", "task_id")
    const taskType = readString(payload, "taskType", "task_type")
    const description = truncateDetail(readString(payload, "description"))
    return makeActivity(
      threadId,
      "task.started",
      "info",
      taskType === "plan"
        ? "Plan task started"
        : taskType
          ? `${taskType} task started`
          : "Task started",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        taskId,
        ...(taskType ? { taskType } : {}),
        ...(description ? { detail: description } : {}),
      },
      [threadId, "task.started", taskId ?? upcomingActivitySequence()]
    )
  }

  if (type === "task.progress" || type === "task_progress") {
    const taskId = readString(payload, "taskId", "task_id")
    const description = readString(payload, "description")
    const summary = readString(payload, "summary")
    const detail = truncateDetail(summary ?? description)
    const lastToolName = readString(
      payload,
      "lastToolName",
      "last_tool_name"
    )
    return makeActivity(
      threadId,
      "task.progress",
      "info",
      "Reasoning update",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        taskId,
        ...(detail ? { detail } : {}),
        ...(summary ? { summary: truncateDetail(summary) } : {}),
        ...(lastToolName ? { lastToolName } : {}),
      },
      [threadId, "task.progress", taskId ?? upcomingActivitySequence()]
    )
  }

  if (type === "task.completed" || type === "task_completed") {
    const taskId = readString(payload, "taskId", "task_id")
    const status = readString(payload, "status") ?? "completed"
    const summary = truncateDetail(readString(payload, "summary"))
    return makeActivity(
      threadId,
      "task.completed",
      status === "failed" ? "error" : "info",
      status === "failed"
        ? "Task failed"
        : status === "stopped"
          ? "Task stopped"
          : "Task completed",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        taskId,
        status,
        ...(summary ? { detail: summary } : {}),
      },
      [threadId, "task.completed", taskId ?? upcomingActivitySequence()]
    )
  }

  if (type === "hook.started" || type === "hook_started") {
    const hookId = readString(payload, "hookId", "hook_id")
    const hookName = readString(payload, "hookName", "hook_name") ?? "hook"
    const hookEvent = readString(payload, "hookEvent", "hook_event")
    return makeActivity(
      threadId,
      "hook.started",
      "info",
      `Hook started: ${hookName}`,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        hookId,
        hookName,
        ...(hookEvent ? { hookEvent } : {}),
      },
      [threadId, "hook.started", hookId ?? upcomingActivitySequence()]
    )
  }

  if (type === "hook.progress" || type === "hook_progress") {
    const hookId = readString(payload, "hookId", "hook_id")
    const detail = outputDetail(payload)
    return makeActivity(
      threadId,
      "hook.progress",
      "info",
      "Hook output",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        hookId,
        ...(detail ? { detail } : {}),
      },
      [threadId, "hook.progress", hookId ?? upcomingActivitySequence()]
    )
  }

  if (
    type === "hook.completed" ||
    type === "hook_response" ||
    type === "hook_completed"
  ) {
    const hookId = readString(payload, "hookId", "hook_id")
    const outcome = readString(payload, "outcome") ?? "success"
    const detail = outputDetail(payload)
    return makeActivity(
      threadId,
      "hook.completed",
      outcome === "error" ? "error" : "info",
      outcome === "error"
        ? "Hook failed"
        : outcome === "cancelled"
          ? "Hook cancelled"
          : "Hook completed",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        hookId,
        outcome,
        ...(detail ? { detail } : {}),
      },
      [threadId, "hook.completed", hookId ?? upcomingActivitySequence()]
    )
  }

  if (type === "auth.status" || type === "auth_status") {
    const error = readString(payload, "error")
    return makeActivity(
      threadId,
      "auth.status",
      error ? "error" : "info",
      error ? "Authentication failed" : "Authentication status updated",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(error ? { detail: error } : {}),
      },
      [threadId, "auth.status", upcomingActivitySequence()]
    )
  }

  if (type === "mcp.oauth.completed" || type === "mcp_oauth_completed") {
    const success = payload.success === true
    const name = readString(payload, "name")
    const error = readString(payload, "error")
    return makeActivity(
      threadId,
      "mcp.oauth.completed",
      success ? "info" : "error",
      success ? "MCP authorization completed" : "MCP authorization failed",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(name ? { detail: name } : {}),
        ...(error ? { detail: error } : {}),
      },
      [threadId, "mcp.oauth.completed", name ?? upcomingActivitySequence()]
    )
  }

  if (type === "model.rerouted" || type === "model_rerouted") {
    const fromModel = readString(payload, "fromModel", "from_model")
    const toModel = readString(payload, "toModel", "to_model")
    const reason = truncateDetail(readString(payload, "reason"))
    return makeActivity(
      threadId,
      "model.rerouted",
      "info",
      fromModel && toModel
        ? `Model rerouted: ${fromModel} -> ${toModel}`
        : "Model rerouted",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(reason ? { detail: reason } : {}),
      },
      [threadId, "model.rerouted", upcomingActivitySequence()]
    )
  }

  if (type === "config.warning" || type === "config_warning") {
    const summary =
      truncateDetail(readString(payload, "summary", "message")) ??
      "Configuration warning"
    const detail = truncateDetail(
      readString(payload, "details", "detail", "path")
    )
    return makeActivity(
      threadId,
      "config.warning",
      "info",
      summary,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(detail ? { detail } : {}),
      },
      [threadId, "config.warning", upcomingActivitySequence()]
    )
  }

  if (
    type === "provider.metadata.changed" ||
    type === "provider_metadata_changed"
  ) {
    const summary =
      truncateDetail(readString(payload, "summary", "message")) ??
      "Provider metadata changed"
    const detail = truncateDetail(
      readString(payload, "details", "detail", "metadataKind")
    )
    return makeActivity(
      threadId,
      "provider.metadata.changed",
      "info",
      summary,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(detail ? { detail } : {}),
      },
      [threadId, "provider.metadata.changed", upcomingActivitySequence()]
    )
  }

  if (type === "deprecation.notice" || type === "deprecation_notice") {
    const summary =
      truncateDetail(readString(payload, "summary", "message")) ??
      "Deprecation notice"
    const detail = truncateDetail(readString(payload, "details", "detail"))
    return makeActivity(
      threadId,
      "deprecation.notice",
      "info",
      summary,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(detail ? { detail } : {}),
      },
      [threadId, "deprecation.notice", upcomingActivitySequence()]
    )
  }

  if (type === "files.persisted" || type === "files_persisted") {
    const files = Array.isArray(payload.files) ? payload.files : []
    const failed = Array.isArray(payload.failed) ? payload.failed : []
    const count = files.length
    const failedCount = failed.length
    return makeActivity(
      threadId,
      "files.persisted",
      failedCount > 0 ? "error" : "info",
      failedCount > 0
        ? `${failedCount} file${failedCount === 1 ? "" : "s"} failed to persist`
        : `${count} file${count === 1 ? "" : "s"} persisted`,
      { ...payload, providerKind, providerInstanceId },
      [threadId, "files.persisted", upcomingActivitySequence()]
    )
  }

  if (
    type === "thread.token-usage.updated" ||
    type === "thread_token_usage_updated"
  ) {
    const usage = usagePayload(payload)
    if (!usage) return null
    return makeActivity(
      threadId,
      "context-window.updated",
      "info",
      "Context window updated",
      { ...payload, ...usage, providerKind, providerInstanceId },
      [threadId, "context-window.updated", upcomingActivitySequence()]
    )
  }

  if (type === "thread.state.changed" || type === "thread_state_changed") {
    const state = readString(payload, "state")
    if (state !== "compacted") return null
    return makeActivity(
      threadId,
      "context-compaction",
      "info",
      "Context compacted",
      { ...payload, providerKind, providerInstanceId },
      [threadId, "context-compaction", upcomingActivitySequence()]
    )
  }

  if (type === "thread.realtime.started") {
    const realtimeSessionId = readString(
      payload,
      "realtimeSessionId",
      "realtime_session_id"
    )
    return makeActivity(
      threadId,
      "thread.realtime.started",
      "info",
      "Realtime session started",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(realtimeSessionId ? { detail: realtimeSessionId } : {}),
      },
      [
        threadId,
        "thread.realtime.started",
        realtimeSessionId ?? upcomingActivitySequence(),
      ]
    )
  }

  if (type === "thread.realtime.error") {
    const message =
      readString(payload, "message", "error") ?? "Realtime error"
    return makeActivity(
      threadId,
      "thread.realtime.error",
      "error",
      message,
      { ...payload, providerKind, providerInstanceId, detail: message },
      [threadId, "thread.realtime.error", upcomingActivitySequence()]
    )
  }

  if (type === "thread.realtime.closed") {
    const reason = readString(payload, "reason", "message")
    return makeActivity(
      threadId,
      "thread.realtime.closed",
      "info",
      "Realtime session closed",
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(reason ? { detail: reason } : {}),
      },
      [threadId, "thread.realtime.closed", reason ?? upcomingActivitySequence()]
    )
  }

  return null
}
