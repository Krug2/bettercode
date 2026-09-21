import type { ProviderRuntimeEvent } from "../../contracts"
import { randomUUID } from "node:crypto"
import { parseTurnDiffFilesFromUnifiedDiff } from "../../contracts"
import type { CodexNotificationContext } from "./context"
import {
  readOptionalString,
  readOptionalNumber,
  readDelta,
  readBase64Text,
  isReasoningDeltaNotification,
  reasoningStreamKind,
  base,
  readToolId,
  readItemId,
  readTurnId,
  basename,
  hookRun,
  hookOutput,
  normalizeHookOutcome,
  patchUpdatedDiff,
  readRequestId,
  normalizeApprovalDecision,
} from "./shared"

/**
 * Streaming deltas and in-flight tool notifications: approvals, agent
 * text, reasoning, command and file-change output, plans, MCP progress,
 * hooks.
 *
 * Returns the translated events, or null when the notification is not one
 * of this family's.
 */
export function translateStreamEvents(
  ctx: CodexNotificationContext
): ProviderRuntimeEvent[] | null {
  const { threadId, native, method, params } = ctx
  const out: ProviderRuntimeEvent[] = []

  if (
    method === "item/autoApprovalReview/started" ||
    method === "item/autoApprovalReview/completed"
  ) {
    const record =
      params && typeof params === "object" && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {}
    const review =
      record.review &&
      typeof record.review === "object" &&
      !Array.isArray(record.review)
        ? (record.review as Record<string, unknown>)
        : {}
    const reviewId =
      readOptionalString(record, ["reviewId", "review_id", "id"]) ??
      randomUUID()
    const status = readOptionalString(review, ["status"])
    const riskLevel = readOptionalString(review, ["riskLevel", "risk_level"])
    const rationale = readOptionalString(review, ["rationale"])
    out.push({
      ...base(threadId),
      type: "item.updated",
      itemId: reviewId,
      kind: "approval_review",
      turnId: readTurnId(record),
      payload: {
        itemType: "approval_review",
        status:
          method === "item/autoApprovalReview/completed"
            ? "completed"
            : "inProgress",
        title: "Auto approval review",
        ...(status || riskLevel || rationale
          ? {
              detail: [status, riskLevel, rationale]
                .filter(
                  (entry): entry is string =>
                    typeof entry === "string" && entry.length > 0
                )
                .join(" · "),
            }
          : {}),
        data: params,
      },
    })
    return out
  }
  if (
    method === "item/requestApproval/decision" ||
    method === "serverRequest/resolved"
  ) {
    const requestId = readRequestId(params, native.requestId)
    if (requestId) {
      out.push({
        ...base(threadId),
        type: "request.resolved",
        requestId,
        turnId: readTurnId(params),
        decision: normalizeApprovalDecision(
          (params as Record<string, unknown>).decision
        ),
      })
    }
    return out
  }
  if (method === "item/tool/requestUserInput/answered") {
    const requestId = readRequestId(params, native.requestId)
    if (requestId) {
      out.push({
        ...base(threadId),
        type: "request.resolved",
        requestId,
        turnId: readTurnId(params),
        decision: "answer",
      })
    }
    return out
  }
  if (method === "agentMessage/delta" || method === "item/agentMessage/delta") {
    const delta = readDelta(params)
    if (delta)
      out.push({
        ...base(threadId),
        type: "content.delta",
        streamKind: "assistant_text",
        delta,
      })
    return out
  }
  if (
    method === "item/reasoning/textDelta" ||
    method === "reasoning/textDelta" ||
    method === "item/reasoning/delta"
  ) {
    const delta = readDelta(params)
    if (delta)
      out.push({
        ...base(threadId),
        type: "reasoning.delta",
        streamKind: "reasoning_text",
        delta,
      })
    return out
  }
  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "reasoning/summaryTextDelta"
  ) {
    const delta = readDelta(params)
    if (delta)
      out.push({
        ...base(threadId),
        type: "reasoning.delta",
        streamKind: "reasoning_summary_text",
        delta,
      })
    return out
  }
  if (isReasoningDeltaNotification(method, params)) {
    const delta = readDelta(params)
    if (delta)
      out.push({
        ...base(threadId),
        type: "reasoning.delta",
        streamKind: reasoningStreamKind(method, params),
        delta,
      })
    return out
  }
  if (
    method === "command/exec/outputDelta" ||
    method === "process/outputDelta"
  ) {
    const record =
      params && typeof params === "object"
        ? (params as Record<string, unknown>)
        : {}
    const delta =
      readBase64Text(record.deltaBase64) ||
      readOptionalString(record, ["delta", "text"]) ||
      ""
    if (delta) {
      out.push({
        ...base(threadId),
        type: "tool.delta",
        toolId:
          readOptionalString(record, [
            "processId",
            "processHandle",
            "id",
            "itemId",
          ]) ?? randomUUID(),
        toolName: "shell",
        turnId: readTurnId(record),
        streamKind: "command_output",
        delta,
      })
    }
    return out
  }
  if (method === "process/exited") {
    const record =
      params && typeof params === "object"
        ? (params as Record<string, unknown>)
        : {}
    const toolId =
      readOptionalString(record, ["processHandle", "processId", "id"]) ??
      randomUUID()
    const exitCode = readOptionalNumber(record, ["exitCode", "exit_code"]) ?? 0
    const output =
      readOptionalString(record, ["stdout", "output"]) ??
      readOptionalString(record, ["stderr"])
    if (exitCode === 0) {
      out.push({
        ...base(threadId),
        type: "tool.completed",
        toolId,
        toolName: "shell",
        turnId: readTurnId(record),
        output: output ?? { exitCode },
      })
    } else {
      out.push({
        ...base(threadId),
        type: "tool.failed",
        toolId,
        toolName: "shell",
        turnId: readTurnId(record),
        error:
          readOptionalString(record, ["stderr", "error"]) ??
          `Process exited with code ${exitCode}`,
        output: output ?? { exitCode },
      })
    }
    return out
  }
  if (method === "item/commandExecution/outputDelta") {
    const delta = readDelta(params)
    if (delta) {
      const payload =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {}
      out.push({
        ...base(threadId),
        type: "tool.delta",
        toolId: readToolId(payload),
        toolName: "shell",
        turnId: readTurnId(payload),
        streamKind: "command_output",
        delta,
      })
    }
    return out
  }
  if (method === "item/fileChange/outputDelta") {
    const delta = readDelta(params)
    if (delta) {
      const payload =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {}
      out.push({
        ...base(threadId),
        type: "tool.delta",
        toolId: readToolId(payload),
        toolName: "file_edit",
        turnId: readTurnId(payload),
        streamKind: "file_change_output",
        delta,
      })
    }
    return out
  }
  if (method === "item/plan/delta") {
    const delta = readDelta(params)
    if (delta) {
      const itemId = readItemId(params)
      out.push({
        ...base(threadId),
        type: "turn.proposed.delta",
        ...(itemId ? { itemId } : {}),
        turnId: readTurnId(params),
        payload: {
          delta,
          ...(itemId ? { itemId, item_id: itemId } : {}),
        },
      })
    }
    return out
  }
  if (method === "item/fileChange/patchUpdated") {
    const patch = patchUpdatedDiff(params)
    if (patch) {
      out.push({
        ...base(threadId),
        type: "turn.diff.updated",
        itemId: patch.itemId,
        turnId: patch.turnId,
        payload: {
          unifiedDiff: patch.delta,
          files: [...parseTurnDiffFilesFromUnifiedDiff(patch.delta)],
        },
      })
      // `patchUpdated` carries the item's whole patch so far, not a chunk.
      // It used to go out as a `tool.delta`, which every consumer appends —
      // the streaming card and the transcript then showed the patch once per
      // update. As the item's cumulative `output` the bridge marks it
      // `cumulative` and both the activity key and the renderer replace.
      out.push({
        ...base(threadId),
        type: "item.updated",
        itemId: patch.itemId,
        kind: "file_change",
        turnId: patch.turnId,
        payload: {
          itemType: "file_change",
          title: "File change",
          ...(patch.detail ? { detail: patch.detail } : {}),
          output: patch.delta,
          data: params,
        },
      })
    }
    return out
  }
  if (
    method === "item/mcpToolCall/progress" ||
    method === "item/mcp_tool_call/progress"
  ) {
    const summary = readOptionalString(params, ["message", "summary", "delta"])
    if (summary) {
      out.push({
        ...base(threadId),
        type: "tool.progress",
        turnId: readTurnId(params),
        payload: {
          summary,
          ...(readOptionalString(params, ["toolUseId", "tool_use_id", "id"])
            ? {
                toolUseId: readOptionalString(params, [
                  "toolUseId",
                  "tool_use_id",
                  "id",
                ]),
              }
            : {}),
          ...(readOptionalString(params, ["toolName", "tool_name", "name"])
            ? {
                toolName: readOptionalString(params, [
                  "toolName",
                  "tool_name",
                  "name",
                ]),
              }
            : {}),
          ...(readOptionalNumber(params, [
            "elapsedSeconds",
            "elapsed_seconds",
            "elapsed_time_seconds",
          ]) !== undefined
            ? {
                elapsedSeconds: readOptionalNumber(params, [
                  "elapsedSeconds",
                  "elapsed_seconds",
                  "elapsed_time_seconds",
                ]),
              }
            : {}),
        },
      })
    }
    return out
  }
  if (method === "hook/started") {
    const run = hookRun(params)
    const sourcePath = readOptionalString(run, ["sourcePath", "source_path"])
    out.push({
      ...base(threadId),
      type: "hook.started",
      turnId: readTurnId(params),
      payload: {
        hookId:
          readOptionalString(run, ["id", "hookId", "hook_id"]) ?? randomUUID(),
        hookName:
          basename(sourcePath) ??
          readOptionalString(run, ["name", "hookName", "hook_name"]) ??
          "hook",
        hookEvent:
          readOptionalString(run, ["eventName", "event_name", "hookEvent"]) ??
          "unknown",
      },
    })
    return out
  }
  if (method === "hook/completed") {
    const run = hookRun(params)
    out.push({
      ...base(threadId),
      type: "hook.completed",
      turnId: readTurnId(params),
      payload: {
        hookId:
          readOptionalString(run, ["id", "hookId", "hook_id"]) ?? randomUUID(),
        outcome: normalizeHookOutcome(readOptionalString(run, ["status"])),
        ...hookOutput(run),
        ...(readOptionalNumber(run, ["durationMs", "duration_ms"]) !== undefined
          ? {
              durationMs: readOptionalNumber(run, [
                "durationMs",
                "duration_ms",
              ]),
            }
          : {}),
      },
    })
    return out
  }

  return null
}
