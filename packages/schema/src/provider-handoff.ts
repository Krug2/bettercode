import { z } from "zod"

export const PROVIDER_HANDOFF_ACTIVITY = "context.provider-handoff"

/** Progress belongs to a specific submitted message, not a provider turn:
 * the destination turn does not exist until compaction has finished. */
export const providerHandoffProgressSchema = z.object({
  status: z.enum(["compacting", "completed", "failed"]),
  requestMessageId: z.string().min(1),
  checkpointMessageId: z.string().min(1),
  sourceProvider: z.string().min(1),
  targetProvider: z.string().min(1),
  sourceModel: z.string().min(1),
})

export type ProviderHandoffProgress = z.infer<typeof providerHandoffProgressSchema>
