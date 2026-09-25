import { z } from "zod"

export const decisionSettingsSchema = z.object({
  mode: z.enum(["off", "jev", "local"]).default("off"),
  localUrl: z.string().max(2048).default("http://127.0.0.1:11434/v1").refine(value => {
    try {
      const url = new URL(value)
      return ["http:", "https:"].includes(url.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.username && !url.password && !url.search && !url.hash
    } catch { return false }
  }, "Use a local model server on localhost or a loopback address"),
  localModel: z.string().trim().max(256).default(""),
  timeoutMs: z.number().int().min(250).max(10000).default(2000),
  minConfidence: z.number().min(0).max(1).default(0.4),
  maxCallsPerTurn: z.number().int().min(1).max(64).default(24),
}).strict()
export type DecisionSettings = z.infer<typeof decisionSettingsSchema>

export const decisionCandidateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  label: z.string().min(1).max(256),
})
export type DecisionCandidate = z.infer<typeof decisionCandidateSchema>

export const decisionRecordSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  kind: z.enum(["route", "context", "recovery"]),
  status: z.enum(["deciding", "selected", "fallback", "cancelled"]),
  mode: z.enum(["off", "jev", "local"]),
  model: z.string(),
  candidates: z.array(decisionCandidateSchema).max(128),
  choice: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  reason: z.string().max(256).nullable(),
  elapsedMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
})
export type DecisionRecord = z.infer<typeof decisionRecordSchema>

export const decisionSnapshotSchema = z.object({
  threadId: z.string(),
  revision: z.number().int().nonnegative(),
  records: z.array(decisionRecordSchema).max(64),
  calls: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  unreported: z.number().int().nonnegative(),
})
export type DecisionSnapshot = z.infer<typeof decisionSnapshotSchema>

export const emptyDecisionSnapshot = (threadId: string): DecisionSnapshot => ({
  threadId, revision: 0, records: [], calls: 0, selected: 0, fallbacks: 0,
  elapsedMs: 0, inputTokens: 0, outputTokens: 0, unreported: 0,
})
