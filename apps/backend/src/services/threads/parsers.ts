import { HttpError } from "../../http/errors"
import type {
  ThreadSaveMessage,
  ThreadSaveRequest,
  ThreadMetaUpsertRequest,
  ThreadMessageUpsertRequest,
  ThreadCheckpointRevertRequest,
  ThreadTruncateRequest,
} from "./types"

export function requiredStr(
  obj: Record<string, unknown>,
  key: string,
  label = `thread.${key}`
): string {
  const value = obj[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `${label} is required`)
  }
  return value
}

export function optionalStr(
  obj: Record<string, unknown>,
  key: string
): string | null {
  const value = obj[key]
  return typeof value === "string" ? value : null
}

export function optionalNullableStr(
  obj: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined
  const value = obj[key]
  if (value === null) return null
  return typeof value === "string" ? value : undefined
}

export function parseThreadSaveMessage(input: unknown): ThreadSaveMessage {
  const message = (input ?? {}) as Record<string, unknown>
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : []
  return {
    message_id: optionalStr(message, "id") ?? "",
    turn_id: optionalStr(message, "turnId"),
    role: optionalStr(message, "role") ?? "user",
    content: optionalStr(message, "content") ?? "",
    created_at: optionalStr(message, "createdAt") ?? "",
    extra: {
      reasoning: message.reasoning ?? null,
      reasoningDurationMs:
        typeof message.reasoningDurationMs === "number" &&
        Number.isFinite(message.reasoningDurationMs) &&
        message.reasoningDurationMs >= 0
          ? message.reasoningDurationMs
          : null,
      toolCalls: message.toolCalls ?? null,
      questions: message.questions ?? null,
      answeredQuestions: message.answeredQuestions ?? null,
      diffs: message.diffs ?? null,
      attachments: attachments.length > 0 ? attachments : null,
      usage: message.usage ?? null,
      modelId: message.modelId ?? null,
      compactedContext: message.compactedContext === true,
      internalContext: message.internalContext,
      compactionGeneration:
        typeof message.compactionGeneration === "number"
          ? message.compactionGeneration
          : null,
    },
  }
}

export function parseThreadSaveRequest(input: unknown): ThreadSaveRequest {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "thread body is required")
  }
  const thread = input as Record<string, unknown>
  const messagesRaw = Array.isArray(thread.messages) ? thread.messages : []

  return {
    thread_id: requiredStr(thread, "id"),
    title: optionalStr(thread, "title") ?? "New Chat",
    project_name: optionalStr(thread, "projectName") ?? "default",
    project_path: optionalStr(thread, "projectPath") ?? "",
    env_mode: optionalNullableStr(thread, "envMode"),
    branch: optionalNullableStr(thread, "branch"),
    worktree_path: optionalNullableStr(thread, "worktreePath"),
    base_branch: optionalNullableStr(thread, "baseBranch"),
    worktree_state: optionalNullableStr(thread, "worktreeState"),
    parent_thread_id: optionalNullableStr(thread, "parentThreadId"),
    created_at: requiredStr(thread, "createdAt"),
    updated_at: requiredStr(thread, "updatedAt"),
    codex_thread_id: optionalStr(thread, "codexThreadId"),
    messages: messagesRaw.map((message) => parseThreadSaveMessage(message)),
  }
}

export function parseThreadMetaUpsertRequest(
  threadId: string,
  input: unknown
): ThreadMetaUpsertRequest {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "thread body is required")
  }

  const thread = input as Record<string, unknown>
  return {
    thread_id: threadId,
    title: optionalStr(thread, "title") ?? "New Chat",
    project_name: optionalStr(thread, "projectName") ?? "default",
    project_path: optionalStr(thread, "projectPath") ?? "",
    env_mode: optionalNullableStr(thread, "envMode"),
    branch: optionalNullableStr(thread, "branch"),
    worktree_path: optionalNullableStr(thread, "worktreePath"),
    base_branch: optionalNullableStr(thread, "baseBranch"),
    worktree_state: optionalNullableStr(thread, "worktreeState"),
    parent_thread_id: optionalNullableStr(thread, "parentThreadId"),
    created_at: requiredStr(thread, "createdAt"),
    updated_at: requiredStr(thread, "updatedAt"),
    codex_thread_id: optionalStr(thread, "codexThreadId"),
  }
}

export function parseThreadMessageUpsertRequest(
  threadId: string,
  input: unknown
): ThreadMessageUpsertRequest {
  const message = parseThreadSaveMessage(input)
  if (!message.message_id) throw new HttpError(400, "message.id is required")
  if (!message.created_at)
    throw new HttpError(400, "message.createdAt is required")
  return { thread_id: threadId, message }
}

export function parseThreadTruncateRequest(
  threadId: string,
  input: unknown
): ThreadTruncateRequest {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "thread truncate body is required")
  }
  const body = input as Record<string, unknown>
  const messageId = requiredStr(body, "messageId", "messageId")
  const updatedAt = optionalStr(body, "updatedAt") ?? new Date().toISOString()
  return { thread_id: threadId, message_id: messageId, updated_at: updatedAt }
}

export function parseThreadCheckpointRevertRequest(
  threadId: string,
  input: unknown,
  staleCheckpointRefs: string[] = []
): ThreadCheckpointRevertRequest {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "thread checkpoint revert body is required")
  }
  const body = input as Record<string, unknown>
  const rawTurnCount = body.turnCount
  const turnCount =
    typeof rawTurnCount === "number"
      ? rawTurnCount
      : typeof rawTurnCount === "string" && rawTurnCount.trim()
        ? Number(rawTurnCount)
        : Number.NaN
  if (!Number.isInteger(turnCount) || turnCount < 0) {
    throw new HttpError(400, "turnCount must be a non-negative integer")
  }
  const updatedAt = optionalStr(body, "updatedAt") ?? new Date().toISOString()
  return {
    thread_id: threadId,
    turn_count: turnCount,
    stale_checkpoint_refs: staleCheckpointRefs,
    updated_at: updatedAt,
  }
}
