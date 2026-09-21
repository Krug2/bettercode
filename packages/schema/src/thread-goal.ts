import { z } from "zod"

export const threadGoalSchema = z.object({
  id: z.string().optional(),
  source: z.literal("betterc0de").optional(),
  objective: z.string().min(1),
  status: z.enum(["active", "paused", "achieved", "blocked", "usageLimited", "budgetLimited", "unknown"]),
  startedAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  providerKind: z.string().optional(),
  turns: z.number().nonnegative().optional(),
  tokens: z.number().nonnegative().optional(),
  tokenBudget: z.number().nonnegative().nullable().optional(),
  timeUsedSeconds: z.number().nonnegative().optional(),
  lastReason: z.string().optional(),
})
export type ThreadGoal = z.infer<typeof threadGoalSchema>
export type ThreadGoalStatus = ThreadGoal["status"]

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function numberValue(
  value: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      return candidate
    }
  }
  return undefined
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function normalizeStatus(
  value: Record<string, unknown>,
  fallback: ThreadGoalStatus
): ThreadGoalStatus {
  const status = stringValue(value, "status", "state")?.toLowerCase()
  if (status === "paused") return "paused"
  if (status === "blocked") return "blocked"
  if (status === "usagelimited" || status === "usage_limited") return "usageLimited"
  if (status === "budgetlimited" || status === "budget_limited") return "budgetLimited"
  if (
    status === "achieved" ||
    status === "complete" ||
    status === "completed" ||
    status === "satisfied"
  ) {
    return "achieved"
  }
  if (status === "active" || status === "running" || status === "in_progress") {
    return "active"
  }
  if (value.paused === true) return "paused"
  if (value.achieved === true || value.completed === true) return "achieved"
  return status ? "unknown" : fallback
}

export function normalizeProviderGoal(
  value: unknown,
  current: ThreadGoal | null | undefined,
  providerKind?: string,
  now = Date.now()
): ThreadGoal | null | undefined {
  // Native provider notifications must not replace a goal owned by the backend
  // scheduler (including a native "no goal" notification on session resume).
  if (current?.source === "betterc0de" && record(value).source !== "betterc0de") return undefined
  if (value === null) return null
  const raw = record(value)
  if (Object.keys(raw).length === 0) return undefined
  if (Object.prototype.hasOwnProperty.call(raw, "goal") && raw.goal === null) return null
  const nested = record(raw.goal)
  if (Object.prototype.hasOwnProperty.call(raw, "goal") && Object.keys(nested).length === 0) return undefined
  const goal = Object.keys(nested).length > 0 ? { ...raw, ...nested } : raw

  // A partial update from a different provider cannot borrow the previous objective.
  const providerMatches = !providerKind || !current?.providerKind || providerKind === current.providerKind
  const objective =
    stringValue(
      goal,
      "objective",
      "condition",
      "description",
      "text",
      "userGoal",
      "user_goal"
    ) ?? (providerMatches ? current?.objective : undefined)
  if (!objective) return undefined

  const providerStartedAt = timestampValue(
    goal.startedAt ?? goal.started_at ?? goal.createdAt ?? goal.created_at
  )
  const sameGoal =
    current &&
    providerMatches &&
    (providerStartedAt !== undefined
      ? providerStartedAt === current.startedAt
      : objective === current.objective)
  const previous = sameGoal ? current : undefined
  const startedAt = providerStartedAt ?? previous?.startedAt ?? now
  const turns = numberValue(
    goal,
    "turns",
    "turnCount",
    "turn_count",
    "evaluatedTurns",
    "evaluated_turns"
  )
  const tokens = numberValue(
    goal,
    "tokens",
    "tokenCount",
    "token_count",
    "tokensUsed",
    "tokens_used"
  )
  const lastReason = stringValue(
    goal,
    "lastReason",
    "last_reason",
    "reason",
    "evaluation"
  )
  const tokenBudget = goal.tokenBudget === null || goal.token_budget === null
    ? null
    : numberValue(goal, "tokenBudget", "token_budget") ?? previous?.tokenBudget
  const timeUsedSeconds = numberValue(goal, "timeUsedSeconds", "time_used_seconds")
    ?? previous?.timeUsedSeconds

  return {
    ...(typeof goal.id === "string" ? { id: goal.id } : {}),
    ...(goal.source === "betterc0de" ? { source: "betterc0de" as const } : {}),
    objective,
    status: normalizeStatus(goal, previous?.status ?? "unknown"),
    startedAt,
    updatedAt: timestampValue(goal.updatedAt ?? goal.updated_at) ?? now,
    ...(providerKind || previous?.providerKind
      ? { providerKind: providerKind ?? previous?.providerKind }
      : {}),
    ...(turns !== undefined
      ? { turns }
      : previous?.turns !== undefined
        ? { turns: previous.turns }
        : {}),
    ...(tokens !== undefined
      ? { tokens }
      : previous?.tokens !== undefined
        ? { tokens: previous.tokens }
        : {}),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    ...(timeUsedSeconds !== undefined ? { timeUsedSeconds } : {}),
    ...(lastReason
      ? { lastReason }
      : previous?.lastReason
        ? { lastReason: previous.lastReason }
        : {}),
  }
}

export type GoalCommand =
  | { action: "status" | "pause" | "resume" | "clear" }
  | { action: "set" | "edit"; objective: string; tokenBudget?: number | null }

/** Shared by desktop, mobile and the backend; unknown text remains an objective. */
export function parseGoalCommand(text: string): GoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  const input = match[1]?.trim() ?? ""
  const verb = input.toLowerCase()
  if (!verb || verb === "status") return { action: "status" }
  if (verb === "continue") return { action: "resume" }
  if (verb === "pause" || verb === "resume" || verb === "clear") return { action: verb }
  const edit = /^(edit|set)(?:\s|$)/i.exec(input)
  let objective = edit ? input.slice(edit[0].length).trim() : input
  let tokenBudget: number | null | undefined
  objective = objective.replace(/(?:^|\s)--budget\s+(\S+)/g, (_, value: string) => {
    tokenBudget = value === "none" ? null : Number(value)
    if (tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) {
      throw new Error("Use --budget with a positive token count, or --budget none.")
    }
    return " "
  }).trim()
  if (!objective || /(?:^|\s)--budget(?:\s|$)/.test(objective)) {
    throw new Error("Use /goal <objective>, /goal edit <objective>, /goal pause, /goal continue, /goal clear or /goal status.")
  }
  return { action: edit?.[1]?.toLowerCase() === "edit" ? "edit" : "set", objective, ...(tokenBudget !== undefined ? { tokenBudget } : {}) }
}

