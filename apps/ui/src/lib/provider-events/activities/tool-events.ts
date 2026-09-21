/**
 * Tool lifecycle: calls, output deltas, results, denials, progress,
 * summaries and canonical item updates.
 *
 * Returns the projected activity, or null when the event is not one of
 * this family's.
 */

import { readString } from "@betterc0de/schema"
import {
  deriveProviderToolActivityPresentation,
  formatToolActivityPresentation,
} from "@betterc0de/schema/tool-activity"
import {
  payloadToolId,
  payloadToolName,
  truncateDetail,
  toolUpdateActivityKey,
  isToolLifecycleItemType,
  toolPresentationFromPayload,
} from "../payload"
import type { ThreadActivity } from "@/lib/chat-store"
import type { ActivityContext } from "./context"
import { makeActivity, upcomingActivitySequence } from "./shared"

export function projectToolActivity(
  ctx: ActivityContext
): ThreadActivity | null {
  const { threadId, type, payload, providerKind, providerInstanceId } = ctx

  if (type === "tool_call") {
    const toolId = payloadToolId(payload)
    const toolName = payloadToolName(payload)
    const presentation = toolPresentationFromPayload(payload)
    return makeActivity(
      threadId,
      "tool.started",
      "tool",
      formatToolActivityPresentation(presentation),
      {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        presentation,
      },
      [threadId, "tool.started", toolId ?? upcomingActivitySequence()]
    )
  }

  if (type === "tool_call_delta") {
    const toolId = payloadToolId(payload)
    const toolName = payloadToolName(payload)
    const presentation = toolPresentationFromPayload(payload)
    return makeActivity(
      threadId,
      "tool.updated",
      "tool",
      formatToolActivityPresentation(presentation, "output"),
      {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        presentation,
      },
      [
        threadId,
        "tool.updated",
        toolUpdateActivityKey(payload, toolId, upcomingActivitySequence()),
      ]
    )
  }

  if (type === "tool_result") {
    const toolId = payloadToolId(payload)
    const toolName = payloadToolName(payload)
    const error = readString(payload, "error")
    const presentation = toolPresentationFromPayload(payload)
    const suffix =
      !error && payload.canonicalItemLifecycle === "completed"
        ? undefined
        : error
          ? "failed"
          : "completed"
    return makeActivity(
      threadId,
      error ? "tool.failed" : "tool.completed",
      error ? "error" : "tool",
      formatToolActivityPresentation(presentation, suffix),
      {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        presentation,
      },
      [
        threadId,
        error ? "tool.failed" : "tool.completed",
        toolId ?? upcomingActivitySequence(),
      ]
    )
  }

  if (type === "tool.denied") {
    const toolId = readString(
      payload,
      "toolUseId",
      "tool_use_id",
      "toolId",
      "tool_id"
    )
    const toolName = payloadToolName(payload)
    const reason = readString(payload, "reason", "detail", "error")
    return makeActivity(
      threadId,
      "tool.denied",
      "error",
      `Tool denied: ${toolName}`,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(toolId ? { toolId } : {}),
        toolName,
        ...(reason ? { reason, detail: reason } : {}),
      },
      [
        threadId,
        "tool.denied",
        readString(payload, "eventId", "event_id") ??
          toolId ??
          upcomingActivitySequence(),
      ]
    )
  }

  if (type === "tool.progress" || type === "tool_progress") {
    const toolId = readString(
      payload,
      "toolUseId",
      "tool_use_id",
      "tool_id",
      "toolId"
    )
    const toolName = readString(payload, "toolName", "tool_name") ?? "tool"
    const summary = truncateDetail(
      readString(payload, "summary", "output_delta", "detail")
    )
    const presentation = deriveProviderToolActivityPresentation({
      toolName,
      title: toolName,
      detail: summary,
      input: payload.input,
      output: summary,
      data: payload,
      fallbackSummary: toolName,
    })
    return makeActivity(
      threadId,
      "tool.updated",
      "tool",
      summary ?? formatToolActivityPresentation(presentation, "output"),
      {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        ...(summary ? { detail: summary, output_delta: summary } : {}),
        presentation,
      },
      [threadId, "tool.progress", toolId ?? upcomingActivitySequence()]
    )
  }

  if (type === "tool.summary" || type === "tool_summary") {
    const summary =
      truncateDetail(readString(payload, "summary")) ?? "Tool summary"
    return makeActivity(
      threadId,
      "tool.summary",
      "tool",
      summary,
      { ...payload, providerKind, providerInstanceId, detail: summary },
      [threadId, "tool.summary", upcomingActivitySequence()]
    )
  }

  if (type === "item.updated" || type === "item_updated") {
    const itemType = readString(payload, "itemType", "item_type", "kind")
    if (!isToolLifecycleItemType(itemType)) return null
    const title = readString(payload, "title") ?? "Tool updated"
    const detail = truncateDetail(readString(payload, "detail"))
    return makeActivity(
      threadId,
      "tool.updated",
      "tool",
      title,
      {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(itemType ? { itemType } : {}),
        ...(detail ? { detail } : {}),
      },
      [
        threadId,
        "item.updated",
        readString(payload, "itemId", "item_id") ?? upcomingActivitySequence(),
      ]
    )
  }

  return null
}
