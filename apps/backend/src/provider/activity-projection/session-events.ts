import { readString } from "@betterc0de/schema"
import type { ThreadActivityProjection } from "../../persistence/projections"
import type { ProjectionContext } from "./context"
import {
  truncateDetail,
  outputDetail,
  makeActivity,
} from "./shared"

/**
 * Provider session, task, hook, auth, MCP and configuration notices.
 */
export function projectSessionEvents(
  ctx: ProjectionContext
): ThreadActivityProjection | null {
  const { eventType, threadId, payload, providerKind, providerInstanceId, createdAt, sequence } = ctx

  if (eventType === "session.started" || eventType === "session_started") {
    const message = truncateDetail(readString(payload, "message"))
    return makeActivity({
      eventType,
      threadId,
      kind: "session.started",
      tone: "info",
      summary: "Provider session started",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(message ? { detail: message } : {}),
      },
      sequence,
      idParts: [threadId, "session.started", sequence],
      createdAt,
    })
  }
  if (
    eventType === "session.configured" ||
    eventType === "session_configured"
  ) {
    return makeActivity({
      eventType,
      threadId,
      kind: "session.configured",
      tone: "info",
      summary: "Provider session configured",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
      },
      sequence,
      idParts: [threadId, "session.configured", sequence],
      createdAt,
    })
  }
  if (
    eventType === "session.state.changed" ||
    eventType === "session_state_changed"
  ) {
    const state = readString(payload, "state", "status") ?? "ready"
    const reason = truncateDetail(readString(payload, "reason", "detail"))
    return makeActivity({
      eventType,
      threadId,
      kind: "session.state.changed",
      tone: state === "error" ? "error" : "info",
      summary:
        state === "error"
          ? "Provider session error"
          : `Provider session ${state}`,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        state,
        ...(reason ? { detail: reason } : {}),
      },
      sequence,
      idParts: [threadId, "session.state.changed", sequence],
      createdAt,
    })
  }
  if (eventType === "session.exited" || eventType === "session_exited") {
    const reason = truncateDetail(readString(payload, "reason"))
    const exitKind = readString(payload, "exitKind", "exit_kind")
    return makeActivity({
      eventType,
      threadId,
      kind: "session.exited",
      tone: exitKind === "error" ? "error" : "info",
      summary:
        exitKind === "error"
          ? "Provider session exited with error"
          : "Provider session exited",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(reason ? { detail: reason } : {}),
        ...(exitKind ? { exitKind } : {}),
      },
      sequence,
      idParts: [threadId, "session.exited", sequence],
      createdAt,
    })
  }
  if (eventType === "task.started" || eventType === "task_started") {
    const taskId = readString(payload, "taskId", "task_id")
    const taskType = readString(payload, "taskType", "task_type")
    const description = truncateDetail(readString(payload, "description"))
    return makeActivity({
      eventType,
      threadId,
      kind: "task.started",
      tone: "info",
      summary:
        taskType === "plan"
          ? "Plan task started"
          : taskType
            ? `${taskType} task started`
            : "Task started",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        taskId,
        ...(taskType ? { taskType } : {}),
        ...(description ? { detail: description } : {}),
      },
      sequence,
      idParts: [threadId, "task.started", taskId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "task.progress" || eventType === "task_progress") {
    const taskId = readString(payload, "taskId", "task_id")
    const description = readString(payload, "description")
    const summary = readString(payload, "summary")
    const detail = truncateDetail(summary ?? description)
    const lastToolName = readString(
      payload,
      "lastToolName",
      "last_tool_name"
    )
    return makeActivity({
      eventType,
      threadId,
      kind: "task.progress",
      tone: "info",
      summary: "Reasoning update",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        taskId,
        ...(detail ? { detail } : {}),
        ...(summary ? { summary: truncateDetail(summary) } : {}),
        ...(lastToolName ? { lastToolName } : {}),
      },
      sequence,
      idParts: [threadId, "task.progress", taskId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "task.completed" || eventType === "task_completed") {
    const taskId = readString(payload, "taskId", "task_id")
    const status = readString(payload, "status") ?? "completed"
    const summary = truncateDetail(readString(payload, "summary"))
    return makeActivity({
      eventType,
      threadId,
      kind: "task.completed",
      tone: status === "failed" ? "error" : "info",
      summary:
        status === "failed"
          ? "Task failed"
          : status === "stopped"
            ? "Task stopped"
            : "Task completed",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        taskId,
        status,
        ...(summary ? { detail: summary } : {}),
      },
      sequence,
      idParts: [threadId, "task.completed", taskId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "hook.started" || eventType === "hook_started") {
    const hookId = readString(payload, "hookId", "hook_id")
    const hookName = readString(payload, "hookName", "hook_name") ?? "hook"
    const hookEvent = readString(payload, "hookEvent", "hook_event")
    return makeActivity({
      eventType,
      threadId,
      kind: "hook.started",
      tone: "info",
      summary: `Hook started: ${hookName}`,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        hookId,
        hookName,
        ...(hookEvent ? { hookEvent } : {}),
      },
      sequence,
      idParts: [threadId, "hook.started", hookId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "hook.progress" || eventType === "hook_progress") {
    const hookId = readString(payload, "hookId", "hook_id")
    const detail = outputDetail(payload)
    return makeActivity({
      eventType,
      threadId,
      kind: "hook.progress",
      tone: "info",
      summary: "Hook output",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        hookId,
        ...(detail ? { detail } : {}),
      },
      sequence,
      idParts: [threadId, "hook.progress", hookId ?? sequence],
      createdAt,
    })
  }
  if (
    eventType === "hook.completed" ||
    eventType === "hook_response" ||
    eventType === "hook_completed"
  ) {
    const hookId = readString(payload, "hookId", "hook_id")
    const outcome = readString(payload, "outcome") ?? "success"
    const detail = outputDetail(payload)
    return makeActivity({
      eventType,
      threadId,
      kind: "hook.completed",
      tone: outcome === "error" ? "error" : "info",
      summary:
        outcome === "error"
          ? "Hook failed"
          : outcome === "cancelled"
            ? "Hook cancelled"
            : "Hook completed",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        hookId,
        outcome,
        ...(detail ? { detail } : {}),
      },
      sequence,
      idParts: [threadId, "hook.completed", hookId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "auth.status" || eventType === "auth_status") {
    const error = readString(payload, "error")
    return makeActivity({
      eventType,
      threadId,
      kind: "auth.status",
      tone: error ? "error" : "info",
      summary: error
        ? "Authentication failed"
        : "Authentication status updated",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(error ? { detail: error } : {}),
      },
      sequence,
      idParts: [threadId, "auth.status", sequence],
      createdAt,
    })
  }
  if (
    eventType === "mcp.oauth.completed" ||
    eventType === "mcp_oauth_completed"
  ) {
    const success = payload.success === true
    const name = readString(payload, "name")
    const error = readString(payload, "error")
    return makeActivity({
      eventType,
      threadId,
      kind: "mcp.oauth.completed",
      tone: success ? "info" : "error",
      summary: success
        ? "MCP authorization completed"
        : "MCP authorization failed",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(name ? { detail: name } : {}),
        ...(error ? { detail: error } : {}),
      },
      sequence,
      idParts: [threadId, "mcp.oauth.completed", name ?? sequence],
      createdAt,
    })
  }
  if (eventType === "model.rerouted" || eventType === "model_rerouted") {
    const fromModel = readString(payload, "fromModel", "from_model")
    const toModel = readString(payload, "toModel", "to_model")
    const reason = truncateDetail(readString(payload, "reason"))
    return makeActivity({
      eventType,
      threadId,
      kind: "model.rerouted",
      tone: "info",
      summary:
        fromModel && toModel
          ? `Model rerouted: ${fromModel} -> ${toModel}`
          : "Model rerouted",
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(reason ? { detail: reason } : {}),
      },
      sequence,
      idParts: [threadId, "model.rerouted", sequence],
      createdAt,
    })
  }
  if (eventType === "config.warning" || eventType === "config_warning") {
    const summary =
      truncateDetail(readString(payload, "summary", "message")) ??
      "Configuration warning"
    const detail = truncateDetail(
      readString(payload, "details", "detail", "path")
    )
    return makeActivity({
      eventType,
      threadId,
      kind: "config.warning",
      tone: "info",
      summary,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(detail ? { detail } : {}),
      },
      sequence,
      idParts: [threadId, "config.warning", sequence],
      createdAt,
    })
  }
  if (
    eventType === "provider.metadata.changed" ||
    eventType === "provider_metadata_changed"
  ) {
    const summary =
      truncateDetail(readString(payload, "summary", "message")) ??
      "Provider metadata changed"
    const detail = truncateDetail(
      readString(payload, "details", "detail", "metadataKind")
    )
    return makeActivity({
      eventType,
      threadId,
      kind: "provider.metadata.changed",
      tone: "info",
      summary,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(detail ? { detail } : {}),
      },
      sequence,
      idParts: [threadId, "provider.metadata.changed", sequence],
      createdAt,
    })
  }
  if (
    eventType === "deprecation.notice" ||
    eventType === "deprecation_notice"
  ) {
    const summary =
      truncateDetail(readString(payload, "summary", "message")) ??
      "Deprecation notice"
    const detail = truncateDetail(readString(payload, "details", "detail"))
    return makeActivity({
      eventType,
      threadId,
      kind: "deprecation.notice",
      tone: "info",
      summary,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(detail ? { detail } : {}),
      },
      sequence,
      idParts: [threadId, "deprecation.notice", sequence],
      createdAt,
    })
  }

  return null
}
