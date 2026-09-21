import { z } from "zod"

const count = z.number().finite().nonnegative()
const amount = count.nullable()

export const usageModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.string(),
  input: count,
  output: count,
  calls: count,
  unreported: count,
  cost: amount,
  inputCost: amount,
  outputCost: amount,
})

export const usageDaySchema = z.object({
  date: z.string(),
  tokens: count,
  calls: count,
  cost: amount,
})

export const usageDashboardSchema = z.object({
  generatedAt: z.string(),
  timeZone: z.string(),
  since: z.string().nullable(),
  tokens: count,
  cost: amount,
  calls: count,
  unreported: count,
  longestChatMs: amount,
  models: z.array(usageModelSchema),
  days: z.array(usageDaySchema),
  fastModeShare: amount,
  reasoning: z.object({ label: z.string(), share: count }).nullable(),
  skills: count.nullable(),
  tools: z.array(z.object({ name: z.string(), runs: count })),
})

export type UsageModel = z.infer<typeof usageModelSchema>
export type UsageDay = z.infer<typeof usageDaySchema>
export type UsageDashboard = z.infer<typeof usageDashboardSchema>
