import { z } from "zod"

/**
 * Multi-stage pipelines — sequential chains of turns (e.g. Plan → Implement
 * → Review) executed by the backend PipelineRunner on a thread, with stop
 * points, per-step model/mode/permission overrides, and sqlite-persisted,
 * reload-safe run state.
 */

export const pipelineChatModeSchema = z.enum([
  "agent",
  "plan",
  "ask",
  "security",
  "debug",
])
export type PipelineChatMode = z.infer<typeof pipelineChatModeSchema>

export const pipelineStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  chatMode: pipelineChatModeSchema.default("agent"),
  /**
   * Prompt template. Whitelisted placeholders (single non-recursive pass):
   * {{user_goal}} {{previous_output}} {{plan}} {{step_output:<StepName>}}
   */
  promptTemplate: z.string().min(1),
  model: z.string().optional(),
  permissionLevel: z.string().optional(),
  /** Pause the run before dispatching this step until the user resumes. */
  stopBefore: z.boolean().default(false),
  continueCondition: z
    .enum(["previous_succeeded", "always"])
    .default("previous_succeeded"),
})
export type PipelineStep = z.infer<typeof pipelineStepSchema>

export const pipelineDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  steps: z.array(pipelineStepSchema).min(1).max(12),
  /** Run all steps inside a per-thread git worktree. */
  useWorktree: z.boolean().default(false),
  /** Code-defined template; not stored in settings, not editable. */
  builtin: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type PipelineDefinition = z.infer<typeof pipelineDefinitionSchema>

export const pipelineStepRunStatusSchema = z.enum([
  "pending",
  "paused_before",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
])
export type PipelineStepRunStatus = z.infer<typeof pipelineStepRunStatusSchema>

export const pipelineStepRunStateSchema = z.object({
  stepId: z.string(),
  name: z.string(),
  status: pipelineStepRunStatusSchema,
  turnId: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  outputPreview: z.string().nullish(),
  error: z.string().nullish(),
})
export type PipelineStepRunState = z.infer<typeof pipelineStepRunStateSchema>

export const pipelineRunStatusSchema = z.enum([
  "running",
  "waiting_step",
  "paused",
  "completed",
  "failed",
  "cancelled",
])
export type PipelineRunStatus = z.infer<typeof pipelineRunStatusSchema>

export const pipelineRunSchema = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  pipelineName: z.string(),
  threadId: z.string(),
  projectPath: z.string().nullish(),
  status: pipelineRunStatusSchema,
  currentStepIndex: z.number().int().nonnegative(),
  steps: z.array(pipelineStepRunStateSchema),
  userGoal: z.string().default(""),
  error: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PipelineRun = z.infer<typeof pipelineRunSchema>

function pickValue<T>(
  raw: Record<string, unknown>,
  camel: string,
  snake: string
): T | undefined {
  const value = raw[camel] ?? raw[snake]
  return value === undefined ? undefined : (value as T)
}

/** Body for POST /pipelines/:id/run (snake/camel tolerant). */
export const pipelineRunRequestSchema = z
  .record(z.string(), z.unknown())
  .transform((raw) => ({
    threadId: z
      .string()
      .min(1, "threadId is required")
      .parse(pickValue<unknown>(raw, "threadId", "thread_id")),
    projectPath:
      z
        .string()
        .nullish()
        .parse(pickValue<unknown>(raw, "projectPath", "project_path")) ?? null,
    userGoal: z
      .string()
      .min(1, "userGoal is required")
      .parse(pickValue<unknown>(raw, "userGoal", "user_goal")),
    providerInstanceId:
      z
        .string()
        .nullish()
        .parse(
          pickValue<unknown>(raw, "providerInstanceId", "provider_instance_id")
        ) ?? null,
    model:
      z
        .string()
        .nullish()
        .parse(pickValue<unknown>(raw, "model", "model")) ?? null,
    permissionLevel:
      z
        .string()
        .nullish()
        .parse(pickValue<unknown>(raw, "permissionLevel", "permission_level")) ??
      null,
    systemInstruction:
      z
        .string()
        .nullish()
        .parse(
          pickValue<unknown>(raw, "systemInstruction", "system_instruction")
        ) ?? null,
    useWorktree:
      z
        .boolean()
        .nullish()
        .parse(pickValue<unknown>(raw, "useWorktree", "use_worktree")) ?? null,
  }))
export type PipelineRunRequestBody = z.infer<typeof pipelineRunRequestSchema>
