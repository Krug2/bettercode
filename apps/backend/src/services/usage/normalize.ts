import { isRecord } from "@betterc0de/schema"

export function normalizeUsage(value: unknown, provider = "") {
  const usage = isRecord(value) ? value : {}
  const number = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = usage[key]
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
    }
    return null
  }
  let input = number("inputTokens", "input_tokens", "prompt_tokens")
  const output = number("outputTokens", "output_tokens", "completion_tokens")
  const read = number("cacheReadTokens", "cache_read_input_tokens", "cache_read_tokens") ?? 0
  const write = number("cacheCreationTokens", "cache_creation_input_tokens", "cache_write_tokens") ?? 0
  if (input !== null && /^(claude|anthropic)(_|$)/.test(provider)) input += read + write
  return {
    input,
    output,
    cost: number("totalCostUsd", "total_cost_usd", "cost", "totalCost", "total_cost"),
    inputCost: number("inputCostUsd", "input_cost_usd", "inputCost"),
    outputCost: number("outputCostUsd", "output_cost_usd", "outputCost"),
  }
}
