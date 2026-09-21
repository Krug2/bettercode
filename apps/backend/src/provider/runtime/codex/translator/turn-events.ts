import type { ProviderRuntimeEvent } from "../../contracts"
import { parseTurnDiffFilesFromUnifiedDiff } from "../../contracts"
import {
  codexTokenUsageSchema,
  codexTurnCompletedSchema,
} from "../protocol"
import type { CodexNotificationContext } from "./context"
import {
  readStringField,
  readOptionalString,
  base,
  readTurnId,
  normalizeUsageSnapshot,
  normalizePlanSteps,
} from "./shared"

/**
 * Turn boundaries, plans, diffs and token usage.
 *
 * Returns the translated events, or null when the notification is not one
 * of this family's.
 */
export function translateTurnEvents(
  ctx: CodexNotificationContext
): ProviderRuntimeEvent[] | null {
  const { threadId, method, params } = ctx
  const out: ProviderRuntimeEvent[] = []

  if (method === "turn/started") {
    const turn = (params as { turn?: { id?: string } }).turn
    if (turn?.id)
      out.push({ ...base(threadId), type: "turn.started", turnId: turn.id })
    return out
  }
  if (method === "turn/completed") {
    const parsed = codexTurnCompletedSchema.safeParse(params)
    if (parsed.success) {
      const t = parsed.data.turn
      const status = t.status ?? "completed"
      out.push({
        ...base(threadId),
        type: "turn.completed",
        turnId: t.id ?? "",
        status,
        error: t.error?.message,
      })
      return out
    }
    const raw = (params ?? {}) as {
      turn?: { id?: unknown; status?: unknown; error?: { message?: unknown } }
      id?: unknown
      status?: unknown
      error?: { message?: unknown }
    }
    const turn = (raw.turn ?? raw) as {
      id?: unknown
      status?: unknown
      error?: { message?: unknown }
    }
    const rawStatus =
      typeof turn.status === "string" ? turn.status.toLowerCase() : ""
    const normalized: "completed" | "failed" | "interrupted" =
      rawStatus === "failed" || rawStatus === "error"
        ? "failed"
        : rawStatus === "interrupted" ||
            rawStatus === "aborted" ||
            rawStatus === "cancelled"
          ? "interrupted"
          : "completed"
    const errorMessage =
      typeof turn.error?.message === "string" ? turn.error.message : undefined
    out.push({
      ...base(threadId),
      type: "turn.completed",
      turnId: typeof turn.id === "string" ? turn.id : "",
      status: normalized,
      error: errorMessage,
    })
    return out
  }
  if (method === "turn/aborted") {
    const p = params as { reason?: string; message?: string }
    out.push({
      ...base(threadId),
      type: "turn.aborted",
      turnId: readTurnId(params),
      payload: {
        reason: p.message ?? p.reason ?? "Turn aborted",
      },
    })
    return out
  }
  if (method === "turn/plan/updated") {
    const record =
      params && typeof params === "object"
        ? (params as Record<string, unknown>)
        : {}
    const plan = normalizePlanSteps(record.plan)
    if (plan.length > 0) {
      out.push({
        ...base(threadId),
        type: "turn.plan.updated",
        turnId: readTurnId(params),
        payload: {
          ...(readOptionalString(record, ["explanation"])
            ? { explanation: readOptionalString(record, ["explanation"]) }
            : {}),
          plan,
        },
      })
    }
    return out
  }
  if (method === "turn/diff/updated") {
    const diff = readStringField(params, ["unifiedDiff", "diff"])
    if (diff) {
      out.push({
        ...base(threadId),
        type: "turn.diff.updated",
        turnId: readTurnId(params),
        payload: {
          unifiedDiff: diff,
          files: [...parseTurnDiffFilesFromUnifiedDiff(diff)],
        },
      })
    }
    return out
  }
  if (
    method === "tokenUsage/updated" ||
    method === "thread/tokenUsage/updated"
  ) {
    const usageRaw =
      (params as { usage?: unknown; tokenUsage?: unknown }).usage ??
      (params as { tokenUsage?: unknown }).tokenUsage ??
      {}
    const usageSnapshot = normalizeUsageSnapshot(params)
    if (method === "thread/tokenUsage/updated" && usageSnapshot) {
      out.push({
        ...base(threadId),
        type: "thread.token-usage.updated",
        turnId: readTurnId(params),
        payload: {
          usage: usageSnapshot as {
            usedTokens: number
          } & Record<string, unknown>,
        },
      })
      return out
    }
    const parsed = codexTokenUsageSchema.safeParse(usageRaw)
    if (parsed.success) {
      const u = parsed.data
      const input = u.input_tokens ?? u.inputTokens ?? 0
      const output = u.output_tokens ?? u.outputTokens ?? 0
      out.push({
        ...base(threadId),
        type: "token.usage",
        usage: {
          inputTokens: input,
          outputTokens: output,
          totalTokens: u.total_tokens ?? u.totalTokens ?? input + output,
          ...((u.cached_input_tokens ?? u.cachedInputTokens) !== undefined
            ? {
                cachedInputTokens: u.cached_input_tokens ?? u.cachedInputTokens,
              }
            : {}),
          ...((u.cache_read_tokens ?? u.cacheReadTokens) !== undefined
            ? { cacheReadTokens: u.cache_read_tokens ?? u.cacheReadTokens }
            : {}),
          ...((u.cache_creation_tokens ?? u.cacheCreationTokens) !== undefined
            ? {
                cacheCreationTokens:
                  u.cache_creation_tokens ?? u.cacheCreationTokens,
              }
            : {}),
          ...((u.reasoning_output_tokens ?? u.reasoningOutputTokens) !==
          undefined
            ? {
                reasoningOutputTokens:
                  u.reasoning_output_tokens ?? u.reasoningOutputTokens,
              }
            : {}),
          ...((u.total_cost_usd ?? u.totalCostUsd) !== undefined
            ? { totalCostUsd: u.total_cost_usd ?? u.totalCostUsd }
            : {}),
          ...((u.duration_ms ?? u.durationMs) !== undefined
            ? { durationMs: u.duration_ms ?? u.durationMs }
            : {}),
          ...((u.tool_uses ?? u.toolUses) !== undefined
            ? { toolUses: u.tool_uses ?? u.toolUses }
            : {}),
        },
      })
    }
    return out
  }

  return null
}
