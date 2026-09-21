import type { PermissionUpdate } from "@betterc0de/schema"
import { permissionUpdateSchema } from "@betterc0de/schema"
import { wildcardMatch } from "./project-permission-rules"
import {
  anyShellSegmentMatches,
  everyShellSegmentMatches,
} from "./bash-command-scope"
import { normalizeAgentPermissionToolName } from "./agent-permission-policy"

/**
 * In-memory mirror of `session`-destination permission rules ("Always allow —
 * this session"). The Claude CLI applies `session` PermissionUpdates only to
 * ITS process, and BetterC0de spawns a fresh CLI process per turn, so those
 * rules would die at end of turn. This mirror re-applies them in `canUseTool`
 * on later turns of the same thread.
 */

export interface SessionPermissionRule {
  readonly behavior: "allow" | "deny" | "ask"
  readonly toolName: string
  readonly ruleContent?: string
}

const rulesByThread = new Map<string, SessionPermissionRule[]>()

type RuleUpdate = Extract<
  PermissionUpdate,
  { type: "addRules" | "replaceRules" | "removeRules" }
>

function sameRule(
  left: SessionPermissionRule,
  right: SessionPermissionRule
): boolean {
  return (
    left.behavior === right.behavior &&
    left.toolName === right.toolName &&
    left.ruleContent === right.ruleContent
  )
}

export interface SessionRuleUpdateResult {
  readonly applied: number
  readonly invalid: number
  /** Non-session updates and provider-native mode/directory settings. */
  readonly providerNative: number
}

/** Applies validated updates in order; replacement is scoped to its behavior. */
function applyRuleUpdate(
  rules: SessionPermissionRule[],
  update: RuleUpdate
): SessionPermissionRule[] {
  const incoming = update.rules.map((rule) => ({
    ...rule,
    behavior: update.behavior,
  }))
  switch (update.type) {
    case "removeRules":
      return rules.filter(
        (rule) => !incoming.some((candidate) => sameRule(rule, candidate))
      )
    case "replaceRules":
      rules = rules.filter((rule) => rule.behavior !== update.behavior)
      break
    case "addRules":
      break
    default: {
      const unreachable: never = update
      return unreachable
    }
  }
  for (const rule of incoming) {
    if (!rules.some((candidate) => sameRule(candidate, rule))) rules.push(rule)
  }
  return rules
}

export function recordSessionPermissionUpdates(
  threadId: string,
  updates: ReadonlyArray<unknown>
): SessionRuleUpdateResult {
  const result = { applied: 0, invalid: 0, providerNative: 0 }
  let rules = [...(rulesByThread.get(threadId) ?? [])]
  for (const raw of updates) {
    const parsed = permissionUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      result.invalid += 1
      continue
    }
    const update = parsed.data
    if (update.destination !== "session") {
      result.providerNative += 1
      continue
    }
    switch (update.type) {
      case "addRules":
      case "replaceRules":
      case "removeRules":
        rules = applyRuleUpdate(rules, update)
        result.applied += 1
        break
      case "setMode":
      case "addDirectories":
      case "removeDirectories":
        result.providerNative += 1
        break
      default: {
        const unreachable: never = update
        throw new Error(`Unsupported permission update: ${String(unreachable)}`)
      }
    }
  }
  if (rules.length) rulesByThread.set(threadId, rules)
  else rulesByThread.delete(threadId)
  return result
}

/**
 * Extract the matchable subject from a tool input the way Claude permission
 * rules do: Bash rules match the command, file rules match the path.
 */
function subjectFromToolInput(toolInput: unknown): string | undefined {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return undefined
  }
  const record = toolInput as Record<string, unknown>
  const candidate =
    record.command ?? record.file_path ?? record.filePath ?? record.path
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined
}

function ruleMatches(
  rule: SessionPermissionRule,
  toolName: string,
  toolInput: unknown
): boolean {
  const normalizedTool = normalizeAgentPermissionToolName(rule.toolName)
  if (normalizedTool !== normalizeAgentPermissionToolName(toolName)) {
    return false
  }
  // A rule with no content is unscoped. Honour it for deny and ask; an
  // unscoped allow would authorize every invocation of
  // the whole normalized tool family — `edit` also covers Write, MultiEdit,
  // NotebookEdit and apply_patch on every path — which is never what the user
  // agreed to when approving one concrete call.
  if (!rule.ruleContent) return rule.behavior !== "allow"
  const subject = subjectFromToolInput(toolInput)
  if (!subject) return false
  // Claude rule contents use "prefix:*" for Bash command prefixes and glob
  // patterns for paths — wildcardMatch covers both after ":" → " " squash.
  const pattern = rule.ruleContent.replace(/:\*$/, " *").replace(/:/g, " ")
  const matchSubject = (candidate: string): boolean =>
    wildcardMatch(candidate.replace(/:/g, " "), pattern) ||
    wildcardMatch(candidate, rule.ruleContent!)

  if (normalizedTool !== "bash") return matchSubject(subject)

  // Command lines are matched per segment so a prefix rule cannot authorize
  // whatever was chained after it. See `bash-command-scope.ts`.
  return rule.behavior === "allow"
    ? everyShellSegmentMatches(subject, matchSubject)
    : anyShellSegmentMatches(subject, matchSubject)
}

export function evaluateSessionRules(
  threadId: string,
  toolName: string,
  toolInput: unknown
): SessionPermissionRule["behavior"] | null {
  const rules = rulesByThread.get(threadId)
  if (!rules || rules.length === 0) return null
  // Deny rules take precedence over allow rules, mirroring the CLI engine.
  for (const rule of rules) {
    if (rule.behavior === "deny" && ruleMatches(rule, toolName, toolInput)) {
      return "deny"
    }
  }
  for (const rule of rules) {
    if (rule.behavior === "ask" && ruleMatches(rule, toolName, toolInput)) {
      return "ask"
    }
  }
  for (const rule of rules) {
    if (rule.behavior === "allow" && ruleMatches(rule, toolName, toolInput)) {
      return "allow"
    }
  }
  return null
}

export function listSessionRules(
  threadId: string
): ReadonlyArray<SessionPermissionRule> {
  return (rulesByThread.get(threadId) ?? []).map((rule) => ({ ...rule }))
}

export function listAllSessionRules(): ReadonlyArray<
  SessionPermissionRule & { threadId: string }
> {
  const all: Array<SessionPermissionRule & { threadId: string }> = []
  for (const [threadId, rules] of rulesByThread) {
    for (const rule of rules) all.push({ ...rule, threadId })
  }
  return all
}

export function deleteSessionRule(
  threadId: string,
  input: { behavior: SessionPermissionRule["behavior"]; rule: string }
): boolean {
  const rules = rulesByThread.get(threadId)
  if (!rules) return false
  const next = rules.filter((rule) => {
    const ruleString = rule.ruleContent
      ? `${rule.toolName}(${rule.ruleContent})`
      : rule.toolName
    return !(rule.behavior === input.behavior && ruleString === input.rule)
  })
  if (next.length === rules.length) return false
  if (next.length === 0) rulesByThread.delete(threadId)
  else rulesByThread.set(threadId, next)
  return true
}

export function clearSessionRules(threadId: string): void {
  rulesByThread.delete(threadId)
}
