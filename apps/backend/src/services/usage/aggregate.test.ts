import { describe, expect, it } from "vitest"
import { aggregateUsage, type UsageRow } from "./aggregate"

const row = (patch: Partial<UsageRow> = {}): UsageRow => ({ model: "example", provider: "openai", createdAt: "2026-01-02T01:00:00Z", usage: { inputTokens: 100, outputTokens: 40 }, tools: [], fast: null, reasoning: null, ...patch })

describe("usage dashboard", () => {
  it("groups by access route and the requested local date", () => {
    const result = aggregateUsage([row(), row({ provider: "local" })], "America/Chicago", null)
    expect(result.tokens).toBe(280)
    expect(result.models).toHaveLength(2)
    expect(result.days).toEqual([{ date: "2026-01-01", tokens: 280, calls: 2, cost: null }])
  })

  it("keeps unknown usage visible without inventing charges or insights", () => {
    const result = aggregateUsage([row({ usage: null }), row({ usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 } })], "UTC", null)
    expect(result).toMatchObject({ tokens: 0, calls: 2, unreported: 1, cost: 0, fastModeShare: null, reasoning: null, skills: null })
    expect(result.models[0]).toMatchObject({ inputCost: null, outputCost: null })
  })

  it("handles prototype-like model and tool names as data", () => {
    const result = aggregateUsage([row({ model: "__proto__", tools: ["constructor", "constructor"] })], "UTC", 3000)
    expect(result.tools).toEqual([{ name: "constructor", runs: 2 }])
    expect(result.models[0].model).toBe("__proto__")
  })
})
