import type { ProviderRuntimeEvent } from "../../contracts"
import type { CodexNotificationContext } from "./context"
import {
  readOptionalString,
  readItemText,
  readReasoningSummary,
  base,
  readToolId,
  readItemId,
  readTurnId,
  normalizeCodexToolName,
  isCodexToolItem,
  compactCodexToolPayload,
  readToolOutput,
  readToolError,
} from "./shared"

/**
 * Item lifecycle: started, completed, raw responses and in-place updates.
 *
 * Returns the translated events, or null when the notification is not one
 * of this family's.
 */
export function translateItemEvents(
  ctx: CodexNotificationContext
): ProviderRuntimeEvent[] | null {
  const { threadId, method, params } = ctx
  const out: ProviderRuntimeEvent[] = []

  if (method === "item/started") {
    const item = ((params as { item?: Record<string, unknown> }).item ??
      {}) as Record<string, unknown>
    const kind = typeof item.type === "string" ? item.type : "unknown"
    const id = typeof item.id === "string" ? item.id : ""
    if (isCodexToolItem(item)) {
      out.push({
        ...base(threadId),
        type: "tool.started",
        toolId: readToolId(item),
        toolName: normalizeCodexToolName(item) || kind,
        turnId: readTurnId(params),
        input: compactCodexToolPayload(item),
      })
      return out
    }
    out.push({
      ...base(threadId),
      type: "item.started",
      itemId: id,
      kind,
      payload: item,
    })
    return out
  }
  if (method === "item/completed") {
    const item = ((params as { item?: Record<string, unknown> }).item ??
      {}) as Record<string, unknown>
    const kind = typeof item.type === "string" ? item.type : "unknown"
    const id = typeof item.id === "string" ? item.id : ""
    const type = typeof item.type === "string" ? item.type : ""
    const lowered = type.toLowerCase()
    if (lowered === "plan" || lowered.includes("plan")) {
      const text = readItemText(item) || readReasoningSummary(item.summary)
      const planItemId = id || readItemId(params)
      if (text)
        out.push({
          ...base(threadId),
          type: "turn.proposed.completed",
          ...(planItemId ? { itemId: planItemId } : {}),
          turnId: readTurnId(params),
          payload: {
            planMarkdown: text,
            ...(planItemId ? { itemId: planItemId, item_id: planItemId } : {}),
          },
        })
    } else if (lowered.includes("agent") || lowered.includes("assistant")) {
      const text = readItemText(item)
      if (text)
        out.push({
          ...base(threadId),
          type: "content.replace",
          streamKind: "assistant_text",
          text,
        })
    } else if (lowered.includes("reasoning")) {
      // `summary` is the standard field when `reasoningSummary: "concise"` is
      // requested, but some Codex CLI builds park the reasoning text in
      // `text`/`content`/`aggregatedText` instead — falling back through
      // `readItemText` keeps the final replace from being silently dropped.
      const text = readReasoningSummary(item.summary) || readItemText(item)
      if (text)
        out.push({
          ...base(threadId),
          type: "reasoning.replace",
          streamKind: "reasoning_summary_text",
          text,
        })
    } else if (isCodexToolItem(item)) {
      const error = readToolError(item)
      if (error) {
        out.push({
          ...base(threadId),
          type: "tool.failed",
          toolId: readToolId(item),
          toolName: normalizeCodexToolName(item) || kind,
          turnId: readTurnId(params),
          error,
          output: readToolOutput(item),
        })
      } else {
        out.push({
          ...base(threadId),
          type: "tool.completed",
          toolId: readToolId(item),
          toolName: normalizeCodexToolName(item) || kind,
          turnId: readTurnId(params),
          output: readToolOutput(item),
        })
      }
      return out
    }
    out.push({
      ...base(threadId),
      type: "item.completed",
      itemId: id,
      kind,
      payload: item,
    })
    return out
  }
  if (method === "rawResponseItem/completed") {
    const item = ((params as { item?: Record<string, unknown> }).item ??
      {}) as Record<string, unknown>
    const type = typeof item.type === "string" ? item.type : "unknown"
    out.push({
      ...base(threadId),
      type: "item.completed",
      itemId: readToolId(item),
      kind: `raw:${type}`,
      turnId: readTurnId(params),
      payload: item,
    })
    return out
  }
  if (
    method === "item/updated" ||
    method === "item/reasoning/summaryPartAdded" ||
    method === "item/commandExecution/terminalInteraction"
  ) {
    const item = ((params as { item?: Record<string, unknown> }).item ??
      params) as Record<string, unknown>
    const itemId = readToolId(item)
    const itemType =
      method === "item/reasoning/summaryPartAdded"
        ? "reasoning"
        : method === "item/commandExecution/terminalInteraction"
          ? "command_execution"
          : typeof item.type === "string"
            ? item.type
            : "unknown"
    out.push({
      ...base(threadId),
      type: "item.updated",
      itemId,
      kind: itemType,
      turnId: readTurnId(params),
      payload: {
        itemType,
        ...(typeof item.status === "string" ? { status: item.status } : {}),
        ...(readOptionalString(item, ["title", "name"])
          ? { title: readOptionalString(item, ["title", "name"]) }
          : {}),
        ...(readOptionalString(item, ["detail", "message", "text"])
          ? { detail: readOptionalString(item, ["detail", "message", "text"]) }
          : {}),
        data: params,
      },
    })
    return out
  }

  return null
}
