import path from "node:path"
import { readConfigValue } from "./formatters"
import {
  invalidProjectPolicy,
  isPermissionAction,
  readBetterC0deProjectConfigs,
} from "./project-config"

export interface ProjectPermissionRuleTemplate {
  permission: string
  pattern: string
  action: "ask" | "allow" | "deny"
  sourcePath: string
}

export async function listProjectPermissions(
  cwd: string
): Promise<ProjectPermissionRuleTemplate[]> {
  const root = path.resolve(cwd)
  const rules: ProjectPermissionRuleTemplate[] = []

  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root,
    { strict: true }
  )) {
    validateProjectPermissionConfig(config, sourcePath)
    rules.push(
      ...projectPermissionRulesFromBetterC0deConfig(config, sourcePath)
    )
  }

  return rules
}

function projectPermissionRulesFromConfig(
  permissionConfig: unknown,
  sourcePath: string
): ProjectPermissionRuleTemplate[] {
  if (isPermissionAction(permissionConfig)) {
    return [
      {
        permission: "*",
        pattern: "*",
        action: permissionConfig,
        sourcePath: `${sourcePath}#permission`,
      },
    ]
  }

  if (
    !permissionConfig ||
    typeof permissionConfig !== "object" ||
    Array.isArray(permissionConfig)
  ) {
    return []
  }

  const rules: ProjectPermissionRuleTemplate[] = []
  for (const [permission, rule] of Object.entries(
    permissionConfig as Record<string, unknown>
  )) {
    if (isPermissionAction(rule)) {
      rules.push({
        permission,
        pattern: "*",
        action: rule,
        sourcePath: `${sourcePath}#permission.${permission}`,
      })
      continue
    }
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue
    for (const [pattern, action] of Object.entries(
      rule as Record<string, unknown>
    )) {
      if (!isPermissionAction(action)) continue
      rules.push({
        permission,
        pattern,
        action,
        sourcePath: `${sourcePath}#permission.${permission}.${pattern}`,
      })
    }
  }
  return rules
}

function validateProjectPermissionConfig(
  config: unknown,
  sourcePath: string
): void {
  const permissionConfig = readConfigValue(config, "permission")
  if (permissionConfig !== undefined) {
    validatePermissionValue(permissionConfig, `${sourcePath}#permission`, true)
  }

  const toolsConfig = readConfigValue(config, "tools")
  if (toolsConfig === undefined) return
  if (
    !toolsConfig ||
    typeof toolsConfig !== "object" ||
    Array.isArray(toolsConfig)
  ) {
    throw invalidProjectPolicy(
      sourcePath,
      "tools must be an object of booleans"
    )
  }
  for (const [tool, enabled] of Object.entries(
    toolsConfig as Record<string, unknown>
  )) {
    if (!tool.trim() || typeof enabled !== "boolean") {
      throw invalidProjectPolicy(
        sourcePath,
        `tools.${tool || "<empty>"} must be boolean`
      )
    }
  }
}

function validatePermissionValue(
  value: unknown,
  location: string,
  allowNested: boolean
): void {
  if (isPermissionAction(value)) return
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidProjectPolicy(
      location,
      "permission action must be ask, allow, or deny"
    )
  }
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!key.trim()) {
      throw invalidProjectPolicy(location, "permission keys must not be empty")
    }
    if (isPermissionAction(nested)) continue
    if (!allowNested) {
      throw invalidProjectPolicy(
        `${location}.${key}`,
        "permission action must be ask, allow, or deny"
      )
    }
    validatePermissionValue(nested, `${location}.${key}`, false)
  }
}

function projectPermissionRulesFromBetterC0deConfig(
  config: unknown,
  sourcePath: string
): ProjectPermissionRuleTemplate[] {
  const fromTools = projectPermissionRulesFromAgentTools(
    readBooleanRecord(readConfigValue(config, "tools")),
    sourcePath
  )
  const explicit = projectPermissionRulesFromConfig(
    readConfigValue(config, "permission"),
    sourcePath
  )
  return mergeProjectPermissionRules(fromTools, explicit)
}

export function projectAgentPermissionRules(
  tools: Record<string, boolean>,
  permissionConfig: unknown,
  sourcePath: string
): ProjectPermissionRuleTemplate[] {
  const fromTools = projectPermissionRulesFromAgentTools(tools, sourcePath)
  const explicit = projectPermissionRulesFromConfig(
    permissionConfig,
    sourcePath
  )
  return mergeProjectPermissionRules(fromTools, explicit)
}

function mergeProjectPermissionRules(
  base: ProjectPermissionRuleTemplate[],
  overrides: ProjectPermissionRuleTemplate[]
): ProjectPermissionRuleTemplate[] {
  if (base.length === 0) return overrides
  if (overrides.length === 0) return base

  const byKey = new Map<string, ProjectPermissionRuleTemplate>()
  for (const rule of base) {
    byKey.set(projectPermissionRuleMergeKey(rule), rule)
  }
  for (const rule of overrides) {
    byKey.set(projectPermissionRuleMergeKey(rule), rule)
  }
  return [...byKey.values()]
}

function projectPermissionRulesFromAgentTools(
  tools: Record<string, boolean>,
  sourcePath: string
): ProjectPermissionRuleTemplate[] {
  return Object.entries(tools)
    .map(([tool, enabled]) => {
      return {
        permission: betterC0dePermissionFromToolName(tool),
        pattern: "*",
        action: enabled ? ("allow" as const) : ("deny" as const),
        sourcePath: `${sourcePath}#tools.${tool}`,
      }
    })
    .sort((left, right) => {
      const key = left.permission.localeCompare(right.permission, undefined, {
        sensitivity: "base",
      })
      return key !== 0
        ? key
        : left.pattern.localeCompare(right.pattern, undefined, {
            sensitivity: "base",
          })
    })
}

function betterC0dePermissionFromToolName(tool: string): string {
  const normalized = tool
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "")
  if (
    ["write", "edit", "patch", "applypatch", "multiedit"].includes(normalized)
  ) {
    return "edit"
  }
  if (["webfetch", "fetch"].includes(normalized)) return "webfetch"
  if (["websearch", "search"].includes(normalized)) return "websearch"
  if (["todowrite", "todo"].includes(normalized)) return "todowrite"
  if (["askuserquestion", "question"].includes(normalized)) return "question"
  if (["exitplanmode", "planexit"].includes(normalized)) return "plan_exit"
  if (["externaldirectory", "externaldir"].includes(normalized)) {
    return "external_directory"
  }
  if (normalized === "repoclone") return "repo_clone"
  if (normalized === "repooverview") return "repo_overview"
  if (normalized === "taskstatus") return "task_status"
  if (normalized === "doomloop") return "doom_loop"
  return normalized
}

function projectPermissionRuleMergeKey(
  rule: Pick<ProjectPermissionRuleTemplate, "permission" | "pattern">
): string {
  return `${rule.permission}\0${rule.pattern}`
}

export function readBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, boolean] =>
        typeof entry[1] === "boolean" && entry[0].trim().length > 0
    )
    .map(([key, item]) => [key, item] as const)
  return Object.fromEntries(entries)
}
