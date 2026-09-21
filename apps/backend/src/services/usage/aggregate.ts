import type { UsageDashboard, UsageModel } from "@betterc0de/schema"
import { normalizeUsage } from "./normalize"

export interface UsageRow {
  model: string
  provider: string
  createdAt: string
  usage: unknown
  tools: string[]
  fast: boolean | null
  reasoning: string | null
}

export function aggregateUsage(rows: Iterable<UsageRow>, timeZone: string, longestChatMs: number | null, now = new Date()): UsageDashboard {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const result: UsageDashboard = {
    generatedAt: now.toISOString(), timeZone, since: null,
    tokens: 0, cost: null, calls: 0, unreported: 0, longestChatMs,
    models: [], days: [], fastModeShare: null, reasoning: null, skills: null, tools: [],
  }
  const models = new Map<string, UsageModel>()
  const days = new Map<string, UsageDashboard["days"][number]>()
  const tools = new Map<string, number>()
  const reasoning = new Map<string, number>()
  let fast = 0, fastKnown = 0, reasoningKnown = 0
  for (const row of rows) {
    const date = new Date(row.createdAt)
    if (!Number.isFinite(date.getTime())) continue
    const usage = normalizeUsage(row.usage, row.provider)
    const id = JSON.stringify([row.provider, row.model])
    const model = models.get(id) ?? { id, model: row.model, provider: row.provider, input: 0, output: 0, calls: 0, unreported: 0, cost: null, inputCost: null, outputCost: null }
    const parts = formatter.formatToParts(date)
    const dayKey = ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-")
    const day = days.get(dayKey) ?? { date: dayKey, tokens: 0, calls: 0, cost: null }
    const tokens = (usage.input ?? 0) + (usage.output ?? 0)
    model.input += usage.input ?? 0
    model.output += usage.output ?? 0
    model.calls++
    day.calls++
    day.tokens += tokens
    result.calls++
    result.tokens += tokens
    if (usage.input === null || usage.output === null) { model.unreported++; result.unreported++ }
    for (const field of ["cost", "inputCost", "outputCost"] as const) {
      if (usage[field] !== null) model[field] = (model[field] ?? 0) + usage[field]
    }
    if (usage.cost !== null) { result.cost = (result.cost ?? 0) + usage.cost; day.cost = (day.cost ?? 0) + usage.cost }
    if (!result.since || date.toISOString() < result.since) result.since = date.toISOString()
    if (row.fast !== null) { fastKnown++; fast += Number(row.fast) }
    if (row.reasoning) { reasoningKnown++; reasoning.set(row.reasoning, (reasoning.get(row.reasoning) ?? 0) + 1) }
    for (const name of row.tools) tools.set(name, (tools.get(name) ?? 0) + 1)
    models.set(id, model)
    days.set(dayKey, day)
  }
  result.models = [...models.values()].sort((a, b) => b.input + b.output - a.input - a.output || a.id.localeCompare(b.id))
  result.days = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  result.tools = [...tools].map(([name, runs]) => ({ name, runs })).sort((a, b) => b.runs - a.runs).slice(0, 8)
  result.fastModeShare = fastKnown ? fast / fastKnown : null
  const favorite = [...reasoning].sort((a, b) => b[1] - a[1])[0]
  result.reasoning = favorite ? { label: favorite[0], share: favorite[1] / reasoningKnown } : null
  return result
}
