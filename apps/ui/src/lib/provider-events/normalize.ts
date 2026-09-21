/**
 * Maps every event shape the renderer can receive (legacy WS frames,
 * canonical `provider.runtimeEvent` rows, plugin events) onto the one
 * vocabulary `handleProviderEvent` switches on.
 */

import { toolFailureText } from "@/lib/execution-diagnostics"
import { readTextDelta } from "./delta-coalescing"
import {
  flattenCanonicalPayload,
  normalizeCanonicalItemEvent,
} from "./payload"

export function normalizeProviderEvent(
  type: string,
  payload: Record<string, unknown>
): { type: string; payload: Record<string, unknown> } {
  switch (type) {
    case "content.delta":
    case "content_delta": {
      const flat = flattenCanonicalPayload(payload)
      const streamKind =
        typeof flat.streamKind === "string" ? flat.streamKind : ""
      const delta = readTextDelta(flat)
      if (
        streamKind === "reasoning_text" ||
        streamKind === "reasoning_summary_text"
      ) {
        return { type: "reasoning_delta", payload: { ...flat, delta } }
      }
      return { type: "content_delta", payload: { ...flat, delta } }
    }
    case "content.replace": {
      const flat = flattenCanonicalPayload(payload)
      const streamKind =
        typeof flat.streamKind === "string" ? flat.streamKind : ""
      if (
        streamKind === "reasoning_text" ||
        streamKind === "reasoning_summary_text"
      ) {
        return { type: "reasoning_replace", payload: flat }
      }
      return { type: "content_replace", payload: flat }
    }
    case "reasoning.delta": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "reasoning_delta",
        payload: { ...flat, delta: readTextDelta(flat) },
      }
    }
    case "reasoning.replace":
      return {
        type: "reasoning_replace",
        payload: flattenCanonicalPayload(payload),
      }
    case "turn.started":
      return { type: "turn_started", payload: flattenCanonicalPayload(payload) }
    case "turn.completed": {
      const flat = flattenCanonicalPayload(payload)
      const status =
        typeof flat.status === "string"
          ? flat.status
          : typeof flat.state === "string"
            ? flat.state
            : "completed"
      if (status === "failed") {
        return {
          type: "turn_error",
          payload: {
            ...flat,
            status,
            error:
              typeof flat.error === "string"
                ? flat.error
                : typeof flat.errorMessage === "string"
                  ? flat.errorMessage
                  : "Turn failed",
          },
        }
      }
      if (status === "interrupted" || status === "cancelled") {
        return { type: "turn_interrupted", payload: { ...flat, status } }
      }
      return { type: "turn_completed", payload: { ...flat, status } }
    }
    case "turn.error":
    case "runtime.error": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "turn_error",
        payload: {
          ...flat,
          error:
            typeof flat.error === "string"
              ? flat.error
              : typeof flat.message === "string"
                ? flat.message
                : "Connection error",
        },
      }
    }
    case "runtime.warning": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "turn_warning",
        payload: {
          ...flat,
          error:
            typeof flat.error === "string"
              ? flat.error
              : typeof flat.message === "string"
                ? flat.message
                : "Provider warning",
        },
      }
    }
    case "request.opened": {
      const flat = flattenCanonicalPayload(payload)
      const requestId =
        typeof flat.requestId === "string"
          ? flat.requestId
          : typeof flat.id === "string"
            ? flat.id
            : ""
      const kind = typeof flat.kind === "string" ? flat.kind : ""
      const requestType =
        typeof flat.requestType === "string" ? flat.requestType : ""
      if (kind === "user_input") {
        return {
          type: "user_input_requested",
          payload: {
            ...flat,
            requestId,
          },
        }
      }
      if (kind === "plan_approval") {
        return {
          type: "plan_approval_requested",
          payload: {
            ...flat,
            requestId,
          },
        }
      }
      if (requestType === "tool_user_input") {
        return {
          type: "request.opened",
          payload: { ...flat, requestId },
        }
      }
      return {
        type: "tool_approval_requested",
        payload: {
          ...flat,
          requestId,
          ...(requestType ? { requestType } : {}),
          tool:
            flat.tool ??
            flat.tool_name ??
            flat.toolName ??
            flat.detail ??
            requestType,
          input: flat.input ?? flat.args ?? {},
        },
      }
    }
    case "request.resolved": {
      const flat = flattenCanonicalPayload(payload)
      const decision =
        typeof flat.decision === "string" ? flat.decision : "resolved"
      const requestType =
        typeof flat.requestType === "string" ? flat.requestType : ""
      const requestKind =
        typeof flat.requestKind === "string" ? flat.requestKind : ""
      if (requestKind === "plan_approval") {
        return {
          type: "plan_approval_resolved",
          payload: {
            ...flat,
            requestId: flat.requestId ?? flat.id,
            decision,
          },
        }
      }
      return {
        type:
          decision === "answer" || requestType === "tool_user_input"
            ? "user_input_resolved"
            : "tool_approval_resolved",
        payload: {
          ...flat,
          requestId: flat.requestId ?? flat.id,
          decision,
          ...(requestType ? { requestType } : {}),
        },
      }
    }
    case "user-input.requested": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "user_input_requested",
        payload: {
          ...flat,
          requestId: flat.requestId ?? flat.request_id ?? flat.id,
        },
      }
    }
    case "user-input.resolved": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "user_input_resolved",
        payload: {
          ...flat,
          requestId: flat.requestId ?? flat.request_id ?? flat.id,
          decision: flat.decision ?? "answer",
        },
      }
    }
    case "session.started":
    case "session.configured":
    case "session.state.changed":
    case "session.exited":
      return { type, payload: flattenCanonicalPayload(payload) }
    case "task.started":
    case "task.progress":
    case "task.completed":
    case "hook.started":
    case "hook.progress":
    case "hook.completed":
    case "pipeline.run.started":
    case "pipeline.step.started":
    case "pipeline.step.completed":
    case "pipeline.run.paused":
    case "pipeline.run.resumed":
    case "pipeline.run.completed":
    case "tool.summary":
    case "tool.denied":
    case "auth.status":
    case "account.updated":
    case "account.rate-limits.updated":
    case "mcp.status.updated":
    case "mcp.oauth.completed":
    case "model.rerouted":
    case "config.warning":
    case "provider.metadata.changed":
    case "provider_metadata_changed":
    case "deprecation.notice":
    case "files.persisted":
    case "thread.started":
    case "thread.state.changed":
    case "thread.metadata.updated":
    case "thread.token-usage.updated":
    case "thread.realtime.started":
    case "thread.realtime.item-added":
    case "thread.realtime.audio.delta":
    case "thread.realtime.error":
    case "thread.realtime.closed":
    case "turn.plan.updated":
    case "turn.proposed.delta":
    case "turn.proposed.completed":
    case "turn.diff.updated":
    case "checkpoint.captured":
      return { type, payload: flattenCanonicalPayload(payload) }
    case "item.started":
    case "item.updated":
    case "item.completed":
      return normalizeCanonicalItemEvent(type, payload)
    case "item_started":
      return normalizeCanonicalItemEvent("item.started", payload)
    case "item_updated":
      return normalizeCanonicalItemEvent("item.updated", payload)
    case "item_completed":
      return normalizeCanonicalItemEvent("item.completed", payload)
    case "turn.aborted":
      return { type, payload: flattenCanonicalPayload(payload) }
    case "plan_completed":
      return {
        type: "turn.proposed.completed",
        payload: flattenCanonicalPayload(payload),
      }
    case "tool.progress": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type,
        payload: {
          ...flat,
          tool_id: flat.toolUseId ?? flat.tool_id,
          tool_name: flat.toolName ?? flat.tool_name,
          output_delta: flat.summary ?? flat.output_delta,
        },
      }
    }
    case "tool.started": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "tool_call",
        payload: {
          ...flat,
          tool_id: flat.toolId ?? flat.tool_id,
          tool_name: flat.toolName ?? flat.tool_name,
          input: flat.input,
          started_at: flat.startedAt ?? flat.started_at,
          turn_id: flat.turnId ?? flat.turn_id,
        },
      }
    }
    case "tool.delta":
      return {
        type: "tool_call_delta",
        payload: {
          ...payload,
          tool_id: payload.toolId ?? payload.tool_id,
          tool_name: payload.toolName ?? payload.tool_name,
          output_delta: payload.delta ?? payload.output_delta,
          turn_id: payload.turnId ?? payload.turn_id,
        },
      }
    case "tool.completed": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "tool_result",
        payload: {
          ...flat,
          tool_id: flat.toolId ?? flat.tool_id,
          tool_name: flat.toolName ?? flat.tool_name,
          output: flat.output,
          completed_at: flat.completedAt ?? flat.completed_at,
          turn_id: flat.turnId ?? flat.turn_id,
        },
      }
    }
    case "tool.failed": {
      const flat = flattenCanonicalPayload(payload)
      return {
        type: "tool_result",
        payload: {
          ...flat,
          tool_id: flat.toolId ?? flat.tool_id,
          tool_name: flat.toolName ?? flat.tool_name,
          output: flat.output,
          error: toolFailureText(flat.error) ?? toolFailureText(flat.output) ?? "Tool failed",
          completed_at: flat.completedAt ?? flat.completed_at,
          turn_id: flat.turnId ?? flat.turn_id,
        },
      }
    }
    default:
      return { type, payload }
  }
}
