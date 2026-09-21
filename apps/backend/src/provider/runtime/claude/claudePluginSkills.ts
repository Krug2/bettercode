import fs from "node:fs"
import path from "node:path"
import type { ProviderSkill } from "@betterc0de/schema"

/**
 * Claude skill reading shared by `ClaudeAdapter.fetchSkills` (user skills in
 * `~/.claude/skills`) and the plugin-skill enumeration below, plus
 * `listClaudePluginSkills`, which surfaces skills bundled inside installed
 * Claude Code CLI plugins (`~/.claude/plugins`).
 *
 * Plugin skills are inventory/metadata only: the `claude` binary already
 * loads enabled plugins natively via `settingSources`, so these entries feed
 * the `$`-picker and skill lists but must never be re-injected into prompts.
 */

export const CLAUDE_SKILL_FILE_CANDIDATES = [
  "SKILL.md",
  "skill.md",
  "README.md",
  "content.md",
]

export async function readClaudeSkill(
  skillsDir: string,
  directoryName: string,
  overrides: { scope?: string; pluginId?: string } = {}
): Promise<ProviderSkill | null> {
  const skillDir = path.join(skillsDir, directoryName)
  let skillPath: string | null = null
  let content = ""
  for (const fileName of CLAUDE_SKILL_FILE_CANDIDATES) {
    const candidate = path.join(skillDir, fileName)
    try {
      const stat = await fs.promises.stat(candidate)
      if (!stat.isFile()) continue
      content = await fs.promises.readFile(candidate, "utf8")
      skillPath = candidate
      break
    } catch {
      // Try the next known skill metadata filename.
    }
  }
  if (!skillPath) return null

  const metadata = parseSkillMarkdownMetadata(content)
  const displayName =
    metadata.displayName ?? metadata.name ?? titleizeSkillName(directoryName)
  const description = metadata.description ?? firstMarkdownParagraph(content)
  const shortDescription = metadata.shortDescription
  return {
    name: directoryName,
    path: skillPath,
    enabled: true,
    scope: overrides.scope ?? "user",
    ...(overrides.pluginId ? { pluginId: overrides.pluginId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(shortDescription ? { shortDescription } : {}),
  }
}

export function parseSkillMarkdownMetadata(content: string): {
  name?: string
  displayName?: string
  description?: string
  shortDescription?: string
} {
  const match = content.match(/^\s*---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const metadata: {
    name?: string
    displayName?: string
    description?: string
    shortDescription?: string
  } = {}
  for (const line of match[1]?.split(/\r?\n/) ?? []) {
    const entry = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/)
    if (!entry) continue
    const key = entry[1]?.toLowerCase().replace(/[-_]/g, "")
    const value = stripYamlScalar(entry[2] ?? "")
    if (!value) continue
    if (key === "name") metadata.name = value
    else if (key === "displayname" || key === "title") {
      metadata.displayName = value
    } else if (key === "description") metadata.description = value
    else if (key === "shortdescription" || key === "summary") {
      metadata.shortDescription = value
    }
  }
  return metadata
}

function stripYamlScalar(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim() || undefined
  }
  return trimmed.replace(/\s+#.*$/, "").trim() || undefined
}

export function firstMarkdownParagraph(content: string): string | undefined {
  const withoutFrontmatter = content.replace(/^\s*---\r?\n[\s\S]*?\r?\n---/, "")
  for (const line of withoutFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("```") ||
      trimmed === "---"
    ) {
      continue
    }
    return trimmed.slice(0, 240)
  }
  return undefined
}

export function titleizeSkillName(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

type InstalledPluginEntry = {
  readonly scope?: unknown
  readonly installPath?: unknown
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

/**
 * `enabledPlugins` in `~/.claude/settings.json` is an object map
 * (`{"id@mp": true|false}`) in current CLI versions and an array of enabled
 * ids in older ones. Installed-but-unlisted plugins default to enabled.
 */
function isPluginEnabled(enabledPlugins: unknown, id: string): boolean {
  if (Array.isArray(enabledPlugins)) return enabledPlugins.includes(id)
  if (enabledPlugins && typeof enabledPlugins === "object") {
    return (enabledPlugins as Record<string, unknown>)[id] !== false
  }
  return true
}

function preferredInstall(raw: unknown): InstalledPluginEntry | null {
  const installs = (Array.isArray(raw) ? raw : [raw]).filter(
    (entry): entry is InstalledPluginEntry =>
      Boolean(entry) && typeof entry === "object"
  )
  if (installs.length === 0) return null
  return installs.find((entry) => entry.scope === "user") ?? installs[0]!
}

/**
 * Enumerate skills bundled in ENABLED installed Claude Code CLI plugins.
 * Registry: `<claudeConfigDir>/plugins/installed_plugins.json` (v2 — values
 * are arrays of installs per `name@marketplace` id); enable state from
 * `<claudeConfigDir>/settings.json`. Any failure degrades to `[]`.
 */
export async function listClaudePluginSkills(
  claudeConfigDir: string
): Promise<ReadonlyArray<ProviderSkill>> {
  try {
    const registryRaw = readJsonFile(
      path.join(claudeConfigDir, "plugins", "installed_plugins.json")
    ) as { plugins?: unknown } | null
    const registry =
      registryRaw?.plugins && typeof registryRaw.plugins === "object"
        ? (registryRaw.plugins as Record<string, unknown>)
        : null
    if (!registry) return []
    const settings = readJsonFile(
      path.join(claudeConfigDir, "settings.json")
    ) as { enabledPlugins?: unknown } | null

    const skills: ProviderSkill[] = []
    for (const [pluginId, rawInstalls] of Object.entries(registry)) {
      if (!isPluginEnabled(settings?.enabledPlugins, pluginId)) continue
      const install = preferredInstall(rawInstalls)
      const installPath =
        typeof install?.installPath === "string" ? install.installPath : null
      if (!installPath) continue
      const skillsDir = path.join(installPath, "skills")
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
      } catch {
        continue
      }
      const pluginSkills = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry) =>
            readClaudeSkill(skillsDir, entry.name, {
              scope: "plugin",
              pluginId,
            })
          )
      )
      for (const skill of pluginSkills) {
        if (skill) skills.push(skill)
      }
    }
    return skills
  } catch {
    return []
  }
}
