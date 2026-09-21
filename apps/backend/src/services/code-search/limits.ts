/** Per-call ceilings shared by retrieval, MCP and the ranker. */
export const SEARCH_LIMITS = {
  entries: 16_000,
  fileBytes: 512 * 1024,
  readBytes: 64 * 1024 * 1024,
  retrievalMs: 8000,
  readConcurrency: 8,
  candidates: 64,
  excerptChars: 2400,
  rankingMs: 8000,
  mcpMs: 20_000,
  // Byte cap below Jev's 32k state-token limit, with room for a question.
  // Packing never guesses token counts from characters / 4.
  rankingStateBytes: 24 * 1024,
  rankingBatchCandidates: 16,
  rankingConcurrency: 2,
} as const
