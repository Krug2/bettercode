import type { ProviderRuntimeEvent } from "../../contracts"
import type { CodexNotificationContext } from "./context"
import {
  readOptionalString,
  readOptionalBoolean,
  readDelta,
  base,
  readTurnId,
  normalizeThreadState,
  isFatalCodexProcessStderrMessage,
} from "./shared"

/**
 * Session, process, thread, realtime, goal and skill notifications.
 *
 * Returns the translated events, or null when the notification is not one
 * of this family's.
 */
export function translateSessionEvents(
  ctx: CodexNotificationContext
): ProviderRuntimeEvent[] | null {
  const { threadId, method, params } = ctx
  const out: ProviderRuntimeEvent[] = []

  if (
    method === "session/connecting" ||
    method === "session/ready" ||
    method === "session/started"
  ) {
    out.push({
      ...base(threadId),
      type: "session.state.changed",
      status:
        method === "session/connecting"
          ? "starting"
          : method === "session/started"
            ? "running"
            : "ready",
    })
    return out
  }
  if (method === "session/exited" || method === "session/closed") {
    out.push({
      ...base(threadId),
      type: "session.state.changed",
      status: "closed",
    })
    return out
  }
  if (method === "process/stderr") {
    const message =
      readOptionalString(params, ["message", "text", "stderr"]) ??
      "Codex process stderr"
    if (isFatalCodexProcessStderrMessage(message)) {
      out.push({
        ...base(threadId),
        type: "runtime.error",
        message: "Codex provider transport failed.",
        class: "provider_error",
      })
    } else {
      out.push({
        ...base(threadId),
        type: "runtime.warning",
        message: "Codex provider reported a process warning.",
        willRetry: false,
      })
    }
    return out
  }
  if (method === "warning" || method === "guardianWarning") {
    out.push({
      ...base(threadId),
      type: "runtime.warning",
      message:
        readOptionalString(params, ["message", "summary", "warning"]) ??
        (method === "guardianWarning"
          ? "Codex guardian warning"
          : "Codex warning"),
      willRetry: false,
      detail: params,
    })
    return out
  }
  if (method === "model/verification") {
    const verifications =
      params &&
      typeof params === "object" &&
      Array.isArray((params as Record<string, unknown>).verifications)
        ? ((params as Record<string, unknown>).verifications as unknown[])
        : []
    out.push({
      ...base(threadId),
      type: "runtime.warning",
      message:
        verifications.length > 0
          ? `Model verification: ${verifications.join(", ")}`
          : "Model verification updated",
      willRetry: false,
      detail: params,
    })
    return out
  }
  if (method === "windows/worldWritableWarning") {
    out.push({
      ...base(threadId),
      type: "runtime.warning",
      message:
        readOptionalString(params, ["message", "summary"]) ??
        "Windows world-writable warning",
      willRetry: false,
      detail: params,
    })
    return out
  }
  if (method === "windowsSandbox/setupCompleted") {
    const success = readOptionalBoolean(params, ["success"])
    out.push({
      ...base(threadId),
      type: "session.state.changed",
      status: success === false ? "error" : "ready",
    })
    if (success === false) {
      out.push({
        ...base(threadId),
        type: "runtime.warning",
        message:
          readOptionalString(params, ["message", "summary"]) ??
          "Windows sandbox setup failed",
        willRetry: false,
        detail: params,
      })
    }
    return out
  }
  if (method === "thread/started") {
    const providerThreadId = readOptionalString(params, [
      "threadId",
      "thread_id",
      "id",
    ])
    const nestedThreadId = readOptionalString(
      (params as { thread?: unknown }).thread,
      ["id"]
    )
    const resolved = providerThreadId ?? nestedThreadId
    if (resolved) {
      out.push({
        ...base(threadId),
        type: "thread.started",
        turnId: readTurnId(params),
        payload: { providerThreadId: resolved },
      })
    }
    return out
  }
  if (method === "thread/realtime/started") {
    out.push({
      ...base(threadId),
      type: "thread.realtime.started",
      turnId: readTurnId(params),
      payload: {
        ...(readOptionalString(params, [
          "realtimeSessionId",
          "realtime_session_id",
          "sessionId",
          "session_id",
        ])
          ? {
              realtimeSessionId: readOptionalString(params, [
                "realtimeSessionId",
                "realtime_session_id",
                "sessionId",
                "session_id",
              ]),
            }
          : {}),
      },
    })
    return out
  }
  if (method === "thread/realtime/itemAdded") {
    const record =
      params && typeof params === "object" && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {}
    out.push({
      ...base(threadId),
      type: "thread.realtime.item-added",
      turnId: readTurnId(params),
      payload: {
        item: record.item ?? params,
      },
    })
    return out
  }
  if (
    method === "thread/realtime/transcript/delta" ||
    method === "thread/realtime/transcript/done"
  ) {
    const delta =
      readDelta(params) ||
      readOptionalString(params, ["transcript", "text", "content"]) ||
      ""
    if (delta) {
      out.push({
        ...base(threadId),
        type: "content.delta",
        streamKind: "assistant_text",
        turnId: readTurnId(params),
        delta,
      })
    }
    return out
  }
  if (method === "thread/realtime/sdp") {
    out.push({
      ...base(threadId),
      type: "thread.realtime.started",
      turnId: readTurnId(params),
      payload: {
        ...(readOptionalString(params, ["realtimeSessionId", "sessionId"])
          ? {
              realtimeSessionId: readOptionalString(params, [
                "realtimeSessionId",
                "sessionId",
              ]),
            }
          : {}),
      },
    })
    return out
  }
  if (method === "thread/realtime/outputAudio/delta") {
    const record =
      params && typeof params === "object" && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {}
    out.push({
      ...base(threadId),
      type: "thread.realtime.audio.delta",
      turnId: readTurnId(params),
      payload: {
        audio: record.audio ?? record.delta ?? record.audioDelta ?? params,
      },
    })
    return out
  }
  if (method === "thread/realtime/error") {
    out.push({
      ...base(threadId),
      type: "thread.realtime.error",
      turnId: readTurnId(params),
      payload: {
        message:
          readOptionalString(params, ["message", "error", "reason"]) ??
          "Realtime error",
      },
    })
    return out
  }
  if (method === "thread/realtime/closed") {
    out.push({
      ...base(threadId),
      type: "thread.realtime.closed",
      turnId: readTurnId(params),
      payload: {
        ...(readOptionalString(params, ["reason", "message"])
          ? { reason: readOptionalString(params, ["reason", "message"]) }
          : {}),
      },
    })
    return out
  }
  if (
    method === "thread/status/changed" ||
    method === "thread/archived" ||
    method === "thread/unarchived" ||
    method === "thread/closed" ||
    method === "thread/compacted"
  ) {
    out.push({
      ...base(threadId),
      type: "thread.state.changed",
      turnId: readTurnId(params),
      payload: {
        state: normalizeThreadState(method, params),
        ...(params !== undefined ? { detail: params } : {}),
      },
    })
    return out
  }
  if (method === "thread/name/updated") {
    const name = readOptionalString(params, [
      "threadName",
      "thread_name",
      "name",
    ])
    out.push({
      ...base(threadId),
      type: "thread.metadata.updated",
      turnId: readTurnId(params),
      payload: {
        ...(name ? { name } : {}),
        metadata:
          params && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : {},
      },
    })
    return out
  }
  if (method === "thread/goal/updated" || method === "thread/goal/cleared") {
    out.push({
      ...base(threadId),
      type: "thread.metadata.updated",
      turnId: readTurnId(params),
      payload: {
        metadata:
          method === "thread/goal/cleared"
            ? { goal: null }
            : { goal: params ?? {} },
      },
    })
    return out
  }
  if (method === "skills/changed") {
    out.push({
      ...base(threadId),
      type: "provider.metadata.changed",
      payload: {
        metadataKind: "skills",
        summary: "Skills changed",
        details: "Codex reported updated skill metadata.",
        ...(params !== undefined ? { range: params } : {}),
      },
    })
    return out
  }

  return null
}
