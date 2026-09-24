import { describe, expect, it } from "vitest"
import { normalizeUsage } from "./normalize"

describe("usage normalization", () => {
  it("keeps cached input and reasoning inside their totals", () => {
    expect(normalizeUsage({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 20, reasoningOutputTokens: 10, totalCostUsd: 0.125 }))
      .toMatchObject({ input: 100, output: 40, cost: 0.125, inputCost: null })
  })

  it("includes separately reported cache input", () => {
    expect(normalizeUsage({ input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 }, "claude"))
      .toMatchObject({ input: 130, output: 40 })
  })

  it("distinguishes missing data from reported zero", () => {
    expect(normalizeUsage({ inputTokens: -1, outputTokens: Infinity, cost: "0" }))
      .toMatchObject({ input: null, output: null, cost: null })
    expect(normalizeUsage({ inputTokens: 0, outputTokens: 0, cost: 0 }))
      .toMatchObject({ input: 0, output: 0, cost: 0 })
  })
})
