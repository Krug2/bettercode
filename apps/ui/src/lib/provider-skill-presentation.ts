import type { ProviderSkill } from "@betterc0de/schema"

function titleCaseWords(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/")
}

export function formatProviderSkillDisplayName(
  skill: Pick<ProviderSkill, "displayName" | "name">,
): string {
  const displayName = skill.displayName?.trim()
  if (displayName) return displayName
  return titleCaseWords(skill.name)
}

export function formatProviderSkillInstallSource(
  skill: Pick<ProviderSkill, "path" | "scope"> &
    Partial<Pick<ProviderSkill, "pluginId">>,
): string | null {
  // Skills bundled inside an installed CLI plugin carry the plugin id
  // (`name@marketplace`) — label them with the plugin name.
  const pluginId = skill.pluginId?.trim()
  if (pluginId) {
    const at = pluginId.lastIndexOf("@")
    return `Plugin: ${at > 0 ? pluginId.slice(0, at) : pluginId}`
  }

  const normalizedPath = normalizePathSeparators(skill.path)
  if (
    normalizedPath.includes("/.codex/plugins/") ||
    normalizedPath.includes("/.agents/plugins/") ||
    normalizedPath.includes("/.claude/plugins/cache/")
  ) {
    return "App"
  }

  const normalizedScope = skill.scope?.trim().toLowerCase()
  if (normalizedScope === "system") return "System"
  if (
    normalizedScope === "project" ||
    normalizedScope === "workspace" ||
    normalizedScope === "local"
  ) {
    return "Project"
  }
  if (normalizedScope === "user" || normalizedScope === "personal") {
    return "Personal"
  }
  if (normalizedScope) return titleCaseWords(normalizedScope)
  return null
}

export function formatProviderSkillCommandDescription(
  skill: Pick<
    ProviderSkill,
    "description" | "displayName" | "name" | "path" | "scope" | "shortDescription"
  > &
    Partial<Pick<ProviderSkill, "pluginId">>,
): string {
  const detail = skill.shortDescription?.trim() || skill.description?.trim()
  const source = formatProviderSkillInstallSource(skill)
  return [
    formatProviderSkillDisplayName(skill),
    detail,
    source,
  ].filter((part): part is string => Boolean(part)).join(" - ")
}
