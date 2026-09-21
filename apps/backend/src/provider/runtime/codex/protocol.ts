import { z } from "zod"

export const codexTokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cached_input_tokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cache_creation_tokens: z.number().int().nonnegative().optional(),
    cacheCreationTokens: z.number().int().nonnegative().optional(),
    reasoning_output_tokens: z.number().int().nonnegative().optional(),
    reasoningOutputTokens: z.number().int().nonnegative().optional(),
    total_cost_usd: z.number().finite().nonnegative().optional(),
    totalCostUsd: z.number().finite().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    tool_uses: z.number().int().nonnegative().optional(),
    toolUses: z.number().int().nonnegative().optional(),
  })
  .partial()
export type CodexTokenUsage = z.infer<typeof codexTokenUsageSchema>

export const codexErrorNotificationSchema = z.object({
  error: z.object({
    message: z.string(),
    codexErrorInfo: z
      .union([
        z
          .object({
            message: z.string().optional(),
            type: z.string().optional(),
          })
          .passthrough(),
        z.string(),
      ])
      .nullable()
      .optional(),
  }),
  willRetry: z.boolean().optional(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
})
export type CodexErrorNotification = z.infer<
  typeof codexErrorNotificationSchema
>

export const codexThreadStartedSchema = z.object({
  thread: z.object({ id: z.string() }),
})

export const codexTurnCompletedSchema = z.object({
  turn: z.object({
    id: z.string().optional(),
    status: z.enum(["completed", "failed", "interrupted"]).optional(),
    error: z
      .object({ message: z.string().optional() })
      .passthrough()
      .optional(),
  }),
})

export const CODEX_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/fileRead/requestApproval",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "applyPatchApproval",
  "execCommandApproval",
  "tool/requestUserInput",
  "item/tool/requestUserInput",
] as const

export const CODEX_HANDLED_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/fileRead/requestApproval",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
  "tool/requestUserInput",
  "item/tool/requestUserInput",
] as const

export type CodexServerRequestMethod =
  (typeof CODEX_SERVER_REQUEST_METHODS)[number]

export type CodexHandledServerRequestMethod =
  (typeof CODEX_HANDLED_SERVER_REQUEST_METHODS)[number]

export function isCodexHandledServerRequestMethod(
  method: string
): method is CodexHandledServerRequestMethod {
  return (CODEX_HANDLED_SERVER_REQUEST_METHODS as readonly string[]).includes(
    method
  )
}
