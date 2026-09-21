import type { ProviderApprovalDecision } from "@betterc0de/schema"
import type { ProjectPermissionRule } from "../../project-permission-rules"
import {
  projectPermissionForTool,
  type ProjectToolFlag,
} from "../../project-tool-policy"

export interface ParsedBetterC0deModelSlug {
  readonly providerID: string
  readonly modelID: string
}

export interface BetterC0dePermissionRule {
  readonly permission: string
  readonly pattern: string
  readonly action: "allow" | "ask" | "deny"
}

export interface BetterC0deQuestion {
  readonly header: string
  readonly question: string
}

export interface BetterC0deQuestionRequest {
  readonly questions: ReadonlyArray<BetterC0deQuestion>
}

const BETTERC0DE_READ_PERMISSIONS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "skill",
  "question",
])

export function parseBetterC0deModelSlug(
  slug: string | null | undefined
): ParsedBetterC0deModelSlug | null {
  if (typeof slug !== "string") return null
  const trimmed = slug.trim()
  const separator = trimmed.indexOf("/")
  if (separator <= 0 || separator === trimmed.length - 1) return null
  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  }
}

export function betterC0deQuestionId(
  index: number,
  question: BetterC0deQuestion
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`
}

export function buildBetterC0dePermissionRules(
  runtimeMode: string | null | undefined
): ReadonlyArray<BetterC0dePermissionRule> {
  const mode = (runtimeMode ?? "").trim().toLowerCase()
  if (mode === "full-access" || mode === "bypass") {
    return [{ permission: "*", pattern: "*", action: "allow" }]
  }

  const askAll: BetterC0dePermissionRule = {
    permission: "*",
    pattern: "*",
    action: "ask",
  }
  const readTools: ReadonlyArray<BetterC0dePermissionRule> = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "list", pattern: "*", action: "allow" },
    { permission: "webfetch", pattern: "*", action: "allow" },
    { permission: "websearch", pattern: "*", action: "allow" },
    { permission: "skill", pattern: "*", action: "allow" },
    { permission: "question", pattern: "*", action: "allow" },
  ]
  const denyMutations: ReadonlyArray<BetterC0dePermissionRule> = [
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "repo_clone", pattern: "*", action: "deny" },
    { permission: "repo_overview", pattern: "*", action: "deny" },
  ]

  if (mode === "plan") {
    return [
      askAll,
      ...readTools,
      { permission: "plan_exit", pattern: "*", action: "allow" },
      { permission: "plan_enter", pattern: "*", action: "deny" },
      ...denyMutations,
    ]
  }

  if (mode === "read-only" || mode === "ask") {
    return [askAll, ...readTools, ...denyMutations]
  }

  if (mode === "security") {
    return [
      askAll,
      ...readTools,
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "external_directory", pattern: "*", action: "ask" },
      { permission: "doom_loop", pattern: "*", action: "ask" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "todowrite", pattern: "*", action: "deny" },
    ]
  }

  if (mode === "auto-accept-edits" || mode === "allow-edits") {
    return [
      askAll,
      ...readTools,
      { permission: "edit", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "external_directory", pattern: "*", action: "ask" },
      { permission: "doom_loop", pattern: "*", action: "ask" },
    ]
  }

  return [askAll, { permission: "question", pattern: "*", action: "allow" }]
}

export function buildBetterC0deSessionPermissionRules(input: {
  readonly runtimeMode: string | null | undefined
  readonly projectPermissionRules?: readonly ProjectPermissionRule[]
  readonly projectToolFlags?: readonly ProjectToolFlag[]
}): ReadonlyArray<BetterC0dePermissionRule> {
  const runtimeMode = normalizeBetterC0deRuntimeMode(input.runtimeMode)
  const baseRules = buildBetterC0dePermissionRules(runtimeMode)
  const projectRules = clampBetterC0deProjectPermissionRules(
    runtimeMode,
    mergeBetterC0deProjectPermissionRules(
      projectToolPermissionRules(input.projectToolFlags ?? []),
      projectPermissionRules(input.projectPermissionRules ?? [])
    )
  )
  if (projectRules.length === 0) return baseRules

  const merged = [...baseRules, ...projectRules]
  if (
    runtimeMode === "plan" ||
    runtimeMode === "read-only" ||
    runtimeMode === "ask"
  ) {
    return [...merged, ...hardDenyBetterC0deMutations()]
  }
  if (runtimeMode === "security") {
    return [
      ...merged,
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "todowrite", pattern: "*", action: "deny" },
    ]
  }
  return merged
}

function projectToolPermissionRules(
  tools: readonly ProjectToolFlag[]
): BetterC0dePermissionRule[] {
  return tools
    .filter((tool) => tool.kind !== "custom")
    .map((tool) => ({
      permission: projectPermissionForTool(tool.tool),
      pattern: "*",
      action: tool.enabled ? "allow" : "deny",
    }))
}

function projectPermissionRules(
  rules: readonly ProjectPermissionRule[]
): BetterC0dePermissionRule[] {
  return rules.map((rule) => ({
    permission: rule.permission,
    pattern: rule.pattern,
    action: rule.action,
  }))
}

function mergeBetterC0deProjectPermissionRules(
  base: BetterC0dePermissionRule[],
  overrides: BetterC0dePermissionRule[]
): BetterC0dePermissionRule[] {
  if (base.length === 0) return overrides
  if (overrides.length === 0) return base

  const byKey = new Map<string, BetterC0dePermissionRule>()
  for (const rule of base) byKey.set(betterC0dePermissionRuleKey(rule), rule)
  for (const rule of overrides) byKey.set(betterC0dePermissionRuleKey(rule), rule)
  return [...byKey.values()]
}

function betterC0dePermissionRuleKey(rule: BetterC0dePermissionRule): string {
  return `${rule.permission}\0${rule.pattern}`
}

function clampBetterC0deProjectPermissionRules(
  runtimeMode: string,
  rules: readonly BetterC0dePermissionRule[]
): BetterC0dePermissionRule[] {
  if (runtimeMode === "full-access" || runtimeMode === "bypass") {
    return [...rules]
  }
  const clamped: BetterC0dePermissionRule[] = []
  for (const rule of rules) {
    if (rule.action !== "allow") {
      clamped.push(rule)
      continue
    }
    const permission = rule.permission.trim().toLowerCase()
    // A wildcard allow cannot be represented safely under a heterogeneous
    // runtime ceiling (reads may be allowed while execution must ask/deny).
    // Dropping it leaves the already-emitted base rules authoritative.
    if (permission === "*") continue
    const ceiling = betterC0deRuntimePermissionCeiling(
      runtimeMode,
      permission
    )
    clamped.push({ ...rule, action: ceiling })
  }
  return clamped
}

function betterC0deRuntimePermissionCeiling(
  runtimeMode: string,
  permission: string
): BetterC0dePermissionRule["action"] {
  if (BETTERC0DE_READ_PERMISSIONS.has(permission)) return "allow"
  if (runtimeMode === "plan" && permission === "plan_exit") return "allow"
  if (
    (runtimeMode === "auto-accept-edits" ||
      runtimeMode === "allow-edits") &&
    permission === "edit"
  ) {
    return "allow"
  }
  if (
    runtimeMode === "plan" ||
    runtimeMode === "read-only" ||
    runtimeMode === "ask"
  ) {
    return "deny"
  }
  if (
    runtimeMode === "security" &&
    (permission === "task" || permission === "todowrite")
  ) {
    return "deny"
  }
  return "ask"
}

function hardDenyBetterC0deMutations(): ReadonlyArray<BetterC0dePermissionRule> {
  return [
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "external_directory", pattern: "*", action: "deny" },
    { permission: "doom_loop", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "repo_clone", pattern: "*", action: "deny" },
    { permission: "repo_overview", pattern: "*", action: "deny" },
  ]
}

function normalizeBetterC0deRuntimeMode(
  runtimeMode: string | null | undefined
): string {
  return (runtimeMode ?? "").trim().toLowerCase()
}

export function toBetterC0dePermissionReply(
  decision: ProviderApprovalDecision
): "once" | "reject" {
  if (decision.kind !== "tool_approval") return "reject"
  return decision.decision === "approve" ? "once" : "reject"
}

export function toBetterC0deQuestionAnswers(
  request: BetterC0deQuestionRequest,
  answers: Record<string, unknown>,
): ReadonlyArray<ReadonlyArray<string>> {
  const resolved: string[][] = []
  request.questions.forEach((question, index) => {
    const keys = [betterC0deQuestionId(index, question), question.header, question.question]
    const value = keys.map(key => answers[key]).find(candidate => candidate != null)
    const candidates = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : []
    resolved.push(candidates.filter((candidate): candidate is string => typeof candidate === "string"))
  })
  return resolved
}

export function mergeBetterC0deAssistantText(previousText: string | undefined, nextText: string): {
  readonly latestText: string; readonly deltaToEmit: string
} {
  const previous = previousText ?? ""
  if (previous.startsWith(nextText)) return { latestText: previous, deltaToEmit: "" }
  const limit = Math.min(previous.length, nextText.length)
  let offset = 0
  for (; offset < limit; offset++) {
    if (previous.charCodeAt(offset) !== nextText.charCodeAt(offset)) break
  }
  return { latestText: nextText, deltaToEmit: nextText.substring(offset) }
}

export function appendBetterC0deAssistantTextDelta(
  previousText: string,
  delta: string
): {
  readonly nextText: string
  readonly deltaToEmit: string
} {
  return {
    nextText: previousText + delta,
    deltaToEmit: delta,
  }
}
