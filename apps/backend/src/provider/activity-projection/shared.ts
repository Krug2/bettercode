import type {
  ThreadActivityProjection,
  ThreadActivityTone,
} from "../../persistence/projections"
import { deriveProviderToolActivityPresentation, asRecord, readString } from "@betterc0de/schema"
import { providerKindFromDriver } from "../runtime/providerKindAliases"

export function flattenProviderPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const nested = asRecord(payload.payload)
  if (Object.keys(nested).length === 0) return payload
  return {
    ...payload,
    ...nested,
    turn_id:
      payload.turnId ?? payload.turn_id ?? nested.turnId ?? nested.turn_id,
  }
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function publicRuntimeDiagnosticPayload(
  payload: Record<string, unknown>,
  providerKind: string | undefined,
  providerInstanceId: string | undefined
): Record<string, unknown> {
  const rawClass = readString(payload, "class")
  const diagnosticClass =
    rawClass &&
    rawClass.length <= 64 &&
    /^[A-Za-z0-9_.-]+$/.test(rawClass)
      ? rawClass
      : undefined
  const eventId = readString(payload, "eventId", "event_id")
  const turnId = readString(payload, "turnId", "turn_id")
  const willRetry =
    typeof payload.willRetry === "boolean" ? payload.willRetry : undefined
  return {
    ...(providerKind ? { providerKind } : {}),
    ...(providerInstanceId ? { providerInstanceId } : {}),
    ...(diagnosticClass ? { class: diagnosticClass } : {}),
    ...(eventId ? { event_id: eventId } : {}),
    ...(turnId ? { turn_id: turnId } : {}),
    ...(willRetry !== undefined ? { willRetry } : {}),
  }
}

export function payloadTurnId(payload: Record<string, unknown>): string | null {
  return readString(payload, "turn_id", "turnId") ?? null
}

export function toolNameFromPayload(payload: Record<string, unknown>): string {
  return readString(payload, "tool_name", "toolName", "tool") ?? "tool"
}

export function toolIdFromPayload(
  payload: Record<string, unknown>
): string | undefined {
  return readString(payload, "tool_id", "toolId", "id")
}

/**
 * True when a `tool_call_delta` payload carries the tool's whole output so
 * far rather than one more chunk: either the bridge marked it (`cumulative`,
 * set for item snapshots such as Codex `patchUpdated`) or, for older rows,
 * the ACP shape where `detail` is mirrored verbatim into `output_delta`.
 * Mirrored in the renderer's `provider-events/payload.ts`.
 */
export function isCumulativeToolOutputPayload(
  payload: Record<string, unknown>
): boolean {
  if (payload.cumulative === true) return true
  const delta = payload.output_delta ?? payload.delta
  return (
    typeof delta === "string" &&
    delta.length > 0 &&
    typeof payload.detail === "string" &&
    payload.detail === delta
  )
}

/**
 * Row key for a `tool.updated` activity.
 *
 * Keyed by the tool call only when the payload is cumulative — an ACP
 * `item.updated` mirrors the whole `detail` so far into `output_delta`, and
 * replacing one row in place is right. A Codex `tool.delta` carries only the
 * new chunk, and the transcript reconstructs the output by concatenating
 * `output_delta` across rows; keying those by tool id collapsed a streamed
 * command output to its last chunk. A chunk therefore keeps its own
 * per-sequence row so nothing is lost. Mirrored in the renderer's
 * `provider-events/payload.ts`.
 */
export function toolUpdateActivityKey(
  payload: Record<string, unknown>,
  toolId: string | undefined,
  sequence: number
): string | number {
  if (!toolId) return sequence
  const delta = payload.output_delta ?? payload.delta
  if (typeof delta !== "string" || delta.length === 0) return toolId
  return isCumulativeToolOutputPayload(payload) ? toolId : sequence
}

export function normalizeProviderKind(
  payload: Record<string, unknown>
): string | undefined {
  return (
    providerKindFromDriver(
      readString(payload, "providerKind", "provider_kind")
    ) ?? providerKindFromDriver(readString(payload, "provider"))
  )
}

export function providerInstanceIdFromPayload(
  payload: Record<string, unknown>
): string | undefined {
  return readString(payload, "providerInstanceId", "provider_instance_id")
}

export function truncateDetail(
  value: string | undefined,
  limit = 180
): string | undefined {
  if (!value) return undefined
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value
}

export function outputDetail(payload: Record<string, unknown>): string | undefined {
  return truncateDetail(
    readString(
      payload,
      "stderr",
      "stdout",
      "output",
      "details",
      "detail",
      "message"
    )
  )
}

export function payloadNumber(
  payload: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

export function usagePayload(
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  const rawUsage = asRecord(payload.usage)
  const source = Object.keys(rawUsage).length > 0 ? rawUsage : payload
  const inputTokens = payloadNumber(source, "inputTokens", "input_tokens") ?? 0
  const outputTokens =
    payloadNumber(source, "outputTokens", "output_tokens") ?? 0
  const usedTokens =
    payloadNumber(
      source,
      "usedTokens",
      "used_tokens",
      "totalTokens",
      "total_tokens"
    ) ?? inputTokens + outputTokens
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) return null
  const out: Record<string, unknown> = { usedTokens }
  const fields: Array<[string, string[]]> = [
    [
      "totalProcessedTokens",
      ["totalProcessedTokens", "total_processed_tokens"],
    ],
    ["maxTokens", ["maxTokens", "max_tokens"]],
    ["inputTokens", ["inputTokens", "input_tokens"]],
    ["cachedInputTokens", ["cachedInputTokens", "cached_input_tokens"]],
    ["outputTokens", ["outputTokens", "output_tokens"]],
    [
      "reasoningOutputTokens",
      ["reasoningOutputTokens", "reasoning_output_tokens"],
    ],
    ["lastUsedTokens", ["lastUsedTokens", "last_used_tokens"]],
    ["lastInputTokens", ["lastInputTokens", "last_input_tokens"]],
    [
      "lastCachedInputTokens",
      ["lastCachedInputTokens", "last_cached_input_tokens"],
    ],
    ["lastOutputTokens", ["lastOutputTokens", "last_output_tokens"]],
    [
      "lastReasoningOutputTokens",
      ["lastReasoningOutputTokens", "last_reasoning_output_tokens"],
    ],
    ["toolUses", ["toolUses", "tool_uses"]],
    ["durationMs", ["durationMs", "duration_ms"]],
  ]
  for (const [target, keys] of fields) {
    const value = payloadNumber(source, ...keys)
    if (value !== undefined) out[target] = value
  }
  const compactsAutomatically =
    source.compactsAutomatically ?? source.compacts_automatically
  if (typeof compactsAutomatically === "boolean")
    out.compactsAutomatically = compactsAutomatically
  return out
}

export function isToolLifecycleItemType(value: string | undefined): boolean {
  const itemType = (value ?? "").toLowerCase()
  return (
    itemType.includes("command") ||
    itemType.includes("tool") ||
    itemType.includes("file") ||
    itemType.includes("search") ||
    itemType.includes("read") ||
    itemType.includes("write") ||
    itemType.includes("patch")
  )
}

export function classifyApprovalRequest(
  toolName: string | undefined,
  input: unknown
): "command" | "file-read" | "file-change" {
  const normalized = (toolName ?? "").toLowerCase()
  const record = asRecord(input)
  if (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("file_change")
  ) {
    return "file-change"
  }
  if (
    normalized.includes("read") ||
    normalized.includes("grep") ||
    normalized.includes("search") ||
    normalized.includes("glob")
  ) {
    return "file-read"
  }
  if (
    typeof record.command === "string" ||
    normalized.includes("bash") ||
    normalized.includes("exec")
  ) {
    return "command"
  }
  return "command"
}

export function requestKindFromCanonicalRequestType(
  requestType: string | undefined
): "command" | "file-read" | "file-change" | undefined {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command"
    case "file_read_approval":
      return "file-read"
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change"
    default:
      return undefined
  }
}

export function approvalRequestedSummary(
  requestKind: "command" | "file-read" | "file-change" | undefined,
  toolName: string | undefined
): string {
  switch (requestKind) {
    case "command":
      return "Command approval requested"
    case "file-read":
      return "File-read approval requested"
    case "file-change":
      return "File-change approval requested"
    default:
      return toolName ? `Approval required for ${toolName}` : "Approval required"
  }
}

export function activityId(
  parts: ReadonlyArray<string | number | undefined | null>
): string {
  return parts
    .filter(
      (part): part is string | number =>
        part !== undefined && part !== null && `${part}`.length > 0
    )
    .map((part) => `${part}`.replace(/\s+/g, "_"))
    .join("::")
}

export function stableTextHash(text: string | undefined): string | undefined {
  if (!text) return undefined
  let hash = 2166136261
  for (let idx = 0; idx < text.length; idx += 1) {
    hash ^= text.charCodeAt(idx)
    hash = Math.imul(hash, 16777619)
  }
  return `hash-${(hash >>> 0).toString(36)}`
}

export function proposedPlanStableId(
  payload: Record<string, unknown>
): string | undefined {
  return stableTextHash(readString(payload, "planMarkdown", "plan_markdown"))
}

export function proposedPlanIdFromPayload(
  threadId: string,
  payload: Record<string, unknown>
): string | undefined {
  const explicitPlanId = readString(payload, "planId", "plan_id")
  if (explicitPlanId) return explicitPlanId

  const turnId = payloadTurnId(payload)
  if (turnId) return `plan:${threadId}:turn:${turnId}`

  const itemId = readString(payload, "itemId", "item_id")
  if (itemId) return `plan:${threadId}:item:${itemId}`

  const eventId = readString(payload, "eventId", "event_id")
  if (eventId) return `plan:${threadId}:event:${eventId}`

  const hash = proposedPlanStableId(payload)
  return hash ? `plan:${threadId}:content:${hash}` : undefined
}

/**
 * The provider's own classification of a tool call. ACP adapters put it under
 * `data.kind`; lifting it to the top level lets the presentation classify a
 * search as a search even when its title is the raw pattern. A `kind` that
 * merely repeats the item type carries no extra information.
 */
export function providerToolKind(
  payload: Record<string, unknown>,
  itemType: string | undefined
): string | undefined {
  const kind =
    readString(payload, "kind") ??
    readString(asRecord(payload.data), "kind")
  return kind && kind !== itemType ? kind : undefined
}

export function toolPresentationFromPayload(payload: Record<string, unknown>) {
  const toolName = toolNameFromPayload(payload)
  return deriveProviderToolActivityPresentation({
    toolName,
    title: readString(payload, "title") ?? toolName,
    detail: readString(payload, "detail"),
    input: payload.input,
    output: payload.output,
    rawInput: payload.rawInput ?? payload.raw_input,
    rawOutput: payload.rawOutput ?? payload.raw_output,
    kind: readString(payload, "kind"),
    itemType: readString(payload, "itemType", "item_type"),
    data: payload,
    fallbackSummary: toolName,
  })
}

export function makeActivity(input: {
  eventType: string
  threadId: string
  kind: string
  tone: ThreadActivityTone
  summary: string
  payload: Record<string, unknown>
  sequence: number
  idParts: ReadonlyArray<string | number | undefined | null>
  createdAt?: string | null
  turnId?: string | null
}): ThreadActivityProjection {
  const payload = {
    ...input.payload,
    eventType: input.eventType,
  }
  return {
    activity_id: activityId(input.idParts),
    thread_id: input.threadId,
    turn_id: input.turnId ?? payloadTurnId(input.payload),
    provider_instance_id: providerInstanceIdFromPayload(payload) ?? null,
    kind: input.kind,
    tone: input.tone,
    summary: input.summary,
    payload,
    sequence: input.sequence,
    created_at: input.createdAt ?? new Date().toISOString(),
  }
}
