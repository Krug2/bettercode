import { isRecord, type UsageDashboard } from "@betterc0de/schema"
import type { Db } from "../../persistence/db"
import { aggregateUsage, type UsageRow } from "./aggregate"

const document = "CASE WHEN json_valid(message.content_json) THEN message.content_json ELSE '{}' END"
const field = (name: string) => `json_extract(${document}, '$.extra.${name}')`

export class UsageService {
  private cache: { revision: number; expires: number; value: UsageDashboard } | null = null

  constructor(private readonly db: Db) {}

  dashboard(timeZone: string): UsageDashboard {
    const revision = (this.db.prepare("SELECT version FROM backend_read_revisions WHERE name = 'stats'").get() as { version: number }).version
    if (this.cache?.revision === revision && this.cache.expires > Date.now() && this.cache.value.timeZone === timeZone) return this.cache.value
    const rows = this.db.prepare(`
      SELECT usage.created_at AS createdAt,
        COALESCE(NULLIF(usage.model_id, ''), NULLIF(turn.model_id, ''), 'Unknown model') AS model,
        COALESCE(${field("providerKind")}, turn.provider_kind, 'unknown') AS provider,
        ${field("usage")} AS usage,
        usage.tools_json AS tools,
        ${field("fastMode")} AS fast,
        COALESCE(${field("reasoningEffort")}, ${field("thinkingMode")}) AS reasoning
      FROM projection_message_usage AS usage
      JOIN projection_messages AS message ON message.message_id = usage.message_id
      LEFT JOIN projection_turns AS turn ON turn.turn_id = message.turn_id AND turn.thread_id = message.thread_id
      WHERE usage.role = 'assistant'
        AND COALESCE(${field("compactedContext")}, 0) <> 1
      ORDER BY usage.created_at
    `).iterate() as Iterable<Record<string, unknown>>
    const duration = this.db.prepare(`
      SELECT MAX(duration) AS value FROM (
        SELECT SUM(MAX(0, (julianday(completed_at) - julianday(started_at)) * 86400000)) AS duration
        FROM projection_turns WHERE completed_at IS NOT NULL GROUP BY thread_id
      )
    `).get() as { value: number | null }
    function* decoded(): Generator<UsageRow> {
      for (const row of rows) {
        const usage = parseJson(row.usage)
        const tools = parseJson(row.tools)
        yield {
          createdAt: String(row.createdAt),
          model: typeof row.model === "string" ? row.model : "Unknown model",
          provider: typeof row.provider === "string" ? row.provider : "unknown",
          usage: isRecord(usage) ? usage : null,
          tools: Array.isArray(tools) ? tools.filter((value): value is string => typeof value === "string") : [],
          fast: row.fast === 1 ? true : row.fast === 0 ? false : null,
          reasoning: typeof row.reasoning === "string" ? row.reasoning : null,
        }
      }
    }
    const value = aggregateUsage(decoded(), timeZone, duration.value === null ? null : Math.round(duration.value))
    this.cache = { revision, expires: Date.now() + 10_000, value }
    return value
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null
  try { return JSON.parse(value) } catch { return null }
}
