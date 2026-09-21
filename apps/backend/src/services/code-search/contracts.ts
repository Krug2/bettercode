import { z } from "zod"
import { SEARCH_LIMITS } from "./limits"

export const CODE_SEARCH_SERVER = "betterc0de_code_search"
export const JEV_MODEL = "jev-1.13.0"
export const JEV_PRICING = {
  usdPerMillionInputTokens: 0.042,
  verifiedAt: "2026-09-19",
  source: "https://docs.typesafe.ai/models",
} as const

const relativePrefix = z.string().max(2048).refine(
  (value) => !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && !/^[a-z]:/i.test(value) && !value.split("/").includes(".."),
  "Use a workspace-relative prefix with forward slashes and no parent traversal."
)

/** Only the backend owns the Jev key; this descriptor contains a local capability. */
export interface CodeSearchServer {
  readonly type: "http"
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}
export type CodeSearchServerResolver = (cwd: string) => Promise<CodeSearchServer | null>

export const searchCodeInput = z.object({
  query: z.string().trim().min(2).max(1000).describe("Question about the code; include identifiers when known."),
  keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(8).optional()
    .describe("Literal identifiers or terms for local candidate retrieval. Defaults to words from query."),
  limit: z.number().int().min(1).max(20).default(10),
  paths: z.array(relativePrefix.min(1)).min(1).max(8).optional()
    .describe("Restrict traversal to workspace-relative path prefixes, e.g. apps/backend/src/ or packages/."),
}).strict()

export const fileMapInput = z.object({
  prefix: relativePrefix.default("").describe("Workspace-relative prefix; restricts traversal as well as returned paths."),
  offset: z.number().int().min(0).max(SEARCH_LIMITS.entries).default(0),
  limit: z.number().int().min(1).max(500).default(100),
}).strict()

const coverage = z.object({
  visitedEntries: z.number().int().nonnegative(),
  readBytes: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  eligibleFiles: z.number().int().nonnegative(),
  scannedFiles: z.number().int().nonnegative(),
  duplicateFiles: z.number().int().nonnegative().describe("Matching files removed by exact content-hash deduplication."),
  excludedWorktrees: z.number().int().nonnegative(),
  incomplete: z.boolean(),
  reasons: z.array(z.enum(["entries", "bytes", "deadline", "depth", "unreadable", "large-file"])),
})
export type SearchCoverage = z.infer<typeof coverage>

export const codeCandidate = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive().describe("1-based UTF-16 column where the excerpt starts on startLine."),
  endLine: z.number().int().positive(),
  excerpt: z.string(),
  excerptTruncated: z.boolean(),
  sha256: z.string().describe("SHA-256 of the complete file bytes read for this snapshot."),
  lexicalScore: z.number(),
})
export type CodeCandidate = z.infer<typeof codeCandidate>

export const rankingUsage = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  complete: z.boolean().describe("False when a failed/malformed request may have unreported billed tokens."),
  estimatedInputCostUsd: z.number().nonnegative().nullable().describe("Published-rate estimate; null if usage or pricing is unknown. Not an invoice."),
  pricing: z.object({ usdPerMillionInputTokens: z.number(), verifiedAt: z.string(), source: z.string() }),
})
export type RankingUsage = z.infer<typeof rankingUsage>

export const searchCodeOutput = z.object({
  ranking: z.enum(["jev", "lexical-fallback", "no-candidates"]),
  model: z.string().nullable(),
  warning: z.string().nullable(),
  candidateCount: z.number().int().nonnegative(),
  lexicalMatchCount: z.number().int().nonnegative(),
  uniqueMatchCount: z.number().int().nonnegative(),
  shortlistTruncated: z.boolean(),
  matches: z.array(codeCandidate.extend({ relevance: z.number().min(0).max(1).nullable() })),
  coverage,
  usage: rankingUsage,
  timingsMs: z.object({ retrieval: z.number().nonnegative(), ranking: z.number().nonnegative(), total: z.number().nonnegative() }),
  scope: z.string(),
})
export const fileMapOutput = z.object({
  files: z.array(z.string()),
  nextOffset: z.number().int().nullable(),
  coverage,
  durationMs: z.number().nonnegative(),
  scope: z.string(),
})
