import { z } from "zod"
import { pick } from "./_helpers"

export const sourceProposedPlanReferenceSchema = z
  .record(z.string(), z.unknown())
  .transform((raw) => ({
    threadId: z
      .string()
      .min(1, "sourceProposedPlan.threadId is required")
      .parse(pick<unknown>(raw, "threadId", "thread_id")),
    planId: z
      .string()
      .min(1, "sourceProposedPlan.planId is required")
      .parse(pick<unknown>(raw, "planId", "plan_id")),
  }))

export type SourceProposedPlanReference = z.infer<
  typeof sourceProposedPlanReferenceSchema
>
