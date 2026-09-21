import fs from "node:fs"
import { randomBytes } from "node:crypto"
import os from "node:os"
import path from "node:path"

/**
 * Read/delete the `permissions.allow|deny|ask` rule arrays of the Claude
 * settings files that "Always allow" decisions persist into:
 *   userSettings    → ~/.claude/settings.json
 *   projectSettings → <cwd>/.claude/settings.json
 *   localSettings   → <cwd>/.claude/settings.local.json
 * The CLI writes these itself (via PermissionResult.updatedPermissions);
 * BetterC0de only lists and removes entries for the settings UI.
 */

export type ClaudePermissionRuleSource =
  | "userSettings"
  | "projectSettings"
  | "localSettings"

export type ClaudePermissionBehavior = "allow" | "deny" | "ask"

export interface ClaudePermissionRuleEntry {
  source: ClaudePermissionRuleSource
  behavior: ClaudePermissionBehavior
  rule: string
  filePath: string
}

const BEHAVIORS: ReadonlyArray<ClaudePermissionBehavior> = [
  "allow",
  "deny",
  "ask",
]

function settingsFilePath(
  source: ClaudePermissionRuleSource,
  input: { homeDir?: string | null; cwd?: string | null }
): string | null {
  if (source === "userSettings") {
    const home = input.homeDir?.trim() || os.homedir()
    return path.join(home, ".claude", "settings.json")
  }
  const cwd = input.cwd?.trim()
  if (!cwd) return null
  return path.join(
    cwd,
    ".claude",
    source === "projectSettings" ? "settings.json" : "settings.local.json"
  )
}

function readSettingsFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function permissionArrays(
  settings: Record<string, unknown>
): Partial<Record<ClaudePermissionBehavior, string[]>> {
  const permissions = settings.permissions
  if (
    !permissions ||
    typeof permissions !== "object" ||
    Array.isArray(permissions)
  ) {
    return {}
  }
  const record = permissions as Record<string, unknown>
  const result: Partial<Record<ClaudePermissionBehavior, string[]>> = {}
  for (const behavior of BEHAVIORS) {
    const value = record[behavior]
    if (Array.isArray(value)) {
      result[behavior] = value.filter(
        (entry): entry is string => typeof entry === "string"
      )
    }
  }
  return result
}

export function listClaudePermissionRules(input: {
  homeDir?: string | null
  cwd?: string | null
}): ClaudePermissionRuleEntry[] {
  const entries: ClaudePermissionRuleEntry[] = []
  const sources: ClaudePermissionRuleSource[] = [
    "userSettings",
    "projectSettings",
    "localSettings",
  ]
  for (const source of sources) {
    const filePath = settingsFilePath(source, input)
    if (!filePath) continue
    const settings = readSettingsFile(filePath)
    if (!settings) continue
    const arrays = permissionArrays(settings)
    for (const behavior of BEHAVIORS) {
      for (const rule of arrays[behavior] ?? []) {
        entries.push({ source, behavior, rule, filePath })
      }
    }
  }
  return entries
}

/**
 * Remove one rule string from one behavior array. Read-modify-write with an
 * atomic temp-file rename (same pattern as SettingsService.persist) so a
 * crash mid-write can't truncate the user's Claude settings.
 */
export function deleteClaudePermissionRule(input: {
  source: ClaudePermissionRuleSource
  behavior: ClaudePermissionBehavior
  rule: string
  homeDir?: string | null
  cwd?: string | null
}): boolean {
  const filePath = settingsFilePath(input.source, input)
  if (!filePath) return false
  const settings = readSettingsFile(filePath)
  if (!settings) return false
  const permissions = settings.permissions
  if (
    !permissions ||
    typeof permissions !== "object" ||
    Array.isArray(permissions)
  ) {
    return false
  }
  const record = permissions as Record<string, unknown>
  const array = record[input.behavior]
  if (!Array.isArray(array)) return false
  const next = array.filter((entry) => entry !== input.rule)
  if (next.length === array.length) return false
  record[input.behavior] = next

  const payload = JSON.stringify(settings, null, 2)
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  let fd: number | null = null
  let created = false
  let renamed = false
  try {
    // A settings document may also hold credentials. Atomic replacement must
    // not widen an existing private file to the process umask's default mode.
    const mode = fs.statSync(filePath).mode & 0o777
    fd = fs.openSync(tmpPath, "wx", mode)
    created = true
    fs.writeFileSync(fd, payload, "utf8")
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(tmpPath, filePath)
    renamed = true
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* best-effort */
      }
    }
    if (created && !renamed) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* best-effort */
      }
    }
  }
  return true
}
