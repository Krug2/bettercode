import type { ThreadActivityProjection } from "../../persistence/projections"
import {
  deriveProviderToolActivityPresentation,
  formatToolActivityPresentation,
  asRecord,
  readString,
} from "@betterc0de/schema"
import type { ProjectionContext } from "./context"
import {
  toolNameFromPayload,
  toolIdFromPayload,
  toolUpdateActivityKey,
  truncateDetail,
  isToolLifecycleItemType,
  providerToolKind,
  toolPresentationFromPayload,
  makeActivity,
} from "./shared"

/**
 * Tool lifecycle: legacy tool_call/tool_result frames, canonical item.* rows,
 * denials, progress and summaries.
 */
export function projectToolEvents(
  ctx: ProjectionContext
): ThreadActivityProjection | null {
  const { eventType, threadId, payload, providerKind, providerInstanceId, createdAt, sequence } = ctx

  if (eventType === "tool_call") {
    const toolId = toolIdFromPayload(payload)
    const toolName = toolNameFromPayload(payload)
    const presentation = toolPresentationFromPayload(payload)
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.started",
      tone: "tool",
      summary: formatToolActivityPresentation(presentation),
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        presentation,
      },
      sequence,
      idParts: [threadId, "tool.started", toolId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "tool_call_delta") {
    const toolId = toolIdFromPayload(payload)
    const toolName = toolNameFromPayload(payload)
    const presentation = toolPresentationFromPayload(payload)
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.updated",
      tone: "tool",
      summary: formatToolActivityPresentation(presentation, "output"),
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        presentation,
      },
      sequence,
      idParts: [
        threadId,
        "tool.updated",
        toolUpdateActivityKey(payload, toolId, sequence),
      ],
      createdAt,
    })
  }
  if (eventType === "tool_result") {
    const toolId = toolIdFromPayload(payload)
    const toolName = toolNameFromPayload(payload)
    const error = readString(payload, "error")
    const presentation = toolPresentationFromPayload(payload)
    return makeActivity({
      eventType,
      threadId,
      kind: error ? "tool.failed" : "tool.completed",
      tone: error ? "error" : "tool",
      summary: formatToolActivityPresentation(
        presentation,
        error ? "failed" : "completed"
      ),
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        presentation,
      },
      sequence,
      idParts: [
        threadId,
        error ? "tool.failed" : "tool.completed",
        toolId ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "tool.denied") {
    const toolId = readString(
      payload,
      "toolUseId",
      "tool_use_id",
      "toolId",
      "tool_id"
    )
    const toolName =
      readString(payload, "toolName", "tool_name", "tool") ?? "tool"
    const reason = truncateDetail(
      readString(payload, "reason", "detail", "error")
    )
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.denied",
      tone: "error",
      summary: `Tool denied: ${toolName}`,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        ...(toolId ? { toolId } : {}),
        toolName,
        ...(reason ? { reason, detail: reason } : {}),
      },
      sequence,
      idParts: [
        threadId,
        "tool.denied",
        readString(payload, "eventId", "event_id") ?? toolId ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "item.started" || eventType === "item_started") {
    const itemType = readString(payload, "itemType", "item_type", "kind")
    if (!isToolLifecycleItemType(itemType)) return null
    const toolId =
      toolIdFromPayload(payload) ??
      readString(payload, "itemId", "item_id", "eventId", "event_id")
    const toolName =
      readString(payload, "tool_name", "toolName", "title") ??
      itemType ??
      "tool"
    const input =
      payload.input ??
      payload.data ??
      (itemType === "command_execution" && typeof payload.detail === "string"
        ? { command: payload.detail }
        : {})
    const kind = providerToolKind(payload, itemType)
    const normalizedPayload = {
      ...payload,
      providerKind,
      providerInstanceId,
      tool_id: toolId,
      tool_name: toolName,
      input,
      ...(itemType ? { itemType } : {}),
      ...(kind ? { kind } : {}),
    }
    const presentation = toolPresentationFromPayload(normalizedPayload)
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.started",
      tone: "tool",
      summary: formatToolActivityPresentation(presentation),
      payload: {
        ...normalizedPayload,
        toolId,
        toolName,
        presentation,
      },
      sequence,
      idParts: [threadId, "tool.started", toolId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "item.completed" || eventType === "item_completed") {
    const itemType = readString(payload, "itemType", "item_type", "kind")
    if (!isToolLifecycleItemType(itemType)) return null
    const toolId =
      toolIdFromPayload(payload) ??
      readString(payload, "itemId", "item_id", "eventId", "event_id")
    const toolName =
      readString(payload, "tool_name", "toolName", "title") ??
      itemType ??
      "tool"
    const output = payload.output ?? payload.data ?? payload.detail ?? {}
    const kind = providerToolKind(payload, itemType)
    const normalizedPayload = {
      ...payload,
      providerKind,
      providerInstanceId,
      tool_id: toolId,
      tool_name: toolName,
      output,
      ...(itemType ? { itemType } : {}),
      ...(kind ? { kind } : {}),
    }
    const error = readString(payload, "error")
    const presentation = toolPresentationFromPayload(normalizedPayload)
    return makeActivity({
      eventType,
      threadId,
      kind: error ? "tool.failed" : "tool.completed",
      tone: error ? "error" : "tool",
      summary: formatToolActivityPresentation(
        presentation,
        error ? "failed" : undefined
      ),
      payload: {
        ...normalizedPayload,
        toolId,
        toolName,
        presentation,
      },
      sequence,
      idParts: [
        threadId,
        error ? "tool.failed" : "tool.completed",
        toolId ?? sequence,
      ],
      createdAt,
    })
  }
  if (eventType === "tool.progress" || eventType === "tool_progress") {
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
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.updated",
      tone: "tool",
      summary:
        summary ?? formatToolActivityPresentation(presentation, "output"),
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        toolId,
        toolName,
        ...(summary ? { detail: summary, output_delta: summary } : {}),
        presentation,
      },
      sequence,
      idParts: [threadId, "tool.progress", toolId ?? sequence],
      createdAt,
    })
  }
  if (eventType === "tool.summary" || eventType === "tool_summary") {
    const summary =
      truncateDetail(readString(payload, "summary")) ?? "Tool summary"
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.summary",
      tone: "tool",
      summary,
      payload: {
        ...payload,
        providerKind,
        providerInstanceId,
        detail: summary,
      },
      sequence,
      idParts: [threadId, "tool.summary", sequence],
      createdAt,
    })
  }
  if (eventType === "item.updated" || eventType === "item_updated") {
    const itemType = readString(payload, "itemType", "item_type", "kind")
    if (!isToolLifecycleItemType(itemType)) return null
    const data = asRecord(payload.data)
    const toolId =
      toolIdFromPayload(payload) ??
      readString(payload, "itemId", "item_id", "eventId", "event_id")
    const toolName =
      readString(payload, "tool_name", "toolName", "title") ??
      itemType ??
      "tool"
    const input =
      payload.input ??
      data.input ??
      data.rawInput ??
      data.raw_input ??
      undefined
    const outputDelta = payload.output_delta ?? payload.delta ?? payload.detail
    const kind = providerToolKind(payload, itemType)
    const normalizedPayload = {
      ...payload,
      providerKind,
      providerInstanceId,
      tool_id: toolId,
      tool_name: toolName,
      ...(input !== undefined ? { input } : {}),
      ...(outputDelta !== undefined ? { output_delta: outputDelta } : {}),
      ...(itemType ? { itemType } : {}),
      ...(kind ? { kind } : {}),
    }
    const presentation = toolPresentationFromPayload(normalizedPayload)
    return makeActivity({
      eventType,
      threadId,
      kind: "tool.updated",
      tone: "tool",
      summary: formatToolActivityPresentation(presentation, "output"),
      payload: {
        ...normalizedPayload,
        toolId,
        toolName,
        presentation,
      },
      sequence,
      idParts: [
        threadId,
        "tool.updated",
        toolUpdateActivityKey(normalizedPayload, toolId, sequence),
      ],
      createdAt,
    })
  }

  return null
}
