import { z } from "zod"

/**
 * Agent Guardrails — in-process guard rules compiled into Claude Agent SDK
 * hooks (PreToolUse / PostToolUse / SessionStart / UserPromptSubmit / Stop).
 *
 * Distinct from the legacy "hooks" settings feature (shell commands run by
 * BetterC0de on app events, `hookSchema` in settings.ts): guardrails run
 * INSIDE the agent loop and can deny/allow/gate tool calls before execution.
 */

export const guardrailTriggerSchema = z.enum([
  "pre_tool_use",
  "post_tool_use",
  "session_start",
  "user_prompt_submit",
  "stop",
])
export type GuardrailTrigger = z.infer<typeof guardrailTriggerSchema>

export const guardrailActionSchema = z.enum([
  "deny",
  "allow",
  "ask",
  "run_command",
  "inject_context",
  "notify",
])
export type GuardrailAction = z.infer<typeof guardrailActionSchema>

export const guardrailMatchSchema = z.object({
  /** SDK tool names to match (e.g. ["Bash"], ["Edit","Write"]); [] = all. */
  tools: z.array(z.string()).default([]),
  /** Pattern tested against the tool subject (bash command / file path); "" = always. */
  pattern: z.string().default(""),
  patternType: z.enum(["glob", "regex"]).default("glob"),
})
export type GuardrailMatch = z.infer<typeof guardrailMatchSchema>

/** Actions valid per trigger — mirrored by the settings UI. */
export const GUARDRAIL_ACTIONS_BY_TRIGGER: Record<
  GuardrailTrigger,
  ReadonlyArray<GuardrailAction>
> = {
  pre_tool_use: ["deny", "allow", "ask"],
  post_tool_use: ["run_command"],
  session_start: ["inject_context"],
  user_prompt_submit: ["inject_context"],
  stop: ["notify"],
}

export const guardrailRuleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    trigger: guardrailTriggerSchema,
    match: guardrailMatchSchema.default({
      tools: [],
      pattern: "",
      patternType: "glob",
    }),
    action: guardrailActionSchema,
    /** deny/ask reason shown to the model and in the transcript. */
    reason: z.string().default(""),
    /** run_command: shell command with ${file} ${tool} ${cwd} placeholders. */
    command: z.string().default(""),
    /** inject_context: text added as additionalContext. */
    context: z.string().default(""),
    timeoutSeconds: z.number().int().positive().max(120).default(10),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    if (!GUARDRAIL_ACTIONS_BY_TRIGGER[rule.trigger].includes(rule.action)) {
      ctx.addIssue({
        code: "custom",
        path: ["action"],
        message: `action "${rule.action}" is not valid for trigger "${rule.trigger}"`,
      })
    }
    if (rule.action === "run_command" && rule.command.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["command"],
        message: "run_command rules require a command",
      })
    }
    if (rule.action === "inject_context" && rule.context.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "inject_context rules require context text",
      })
    }
  })
export type GuardrailRule = z.infer<typeof guardrailRuleSchema>

export const guardrailRulesSchema = z.array(guardrailRuleSchema)
