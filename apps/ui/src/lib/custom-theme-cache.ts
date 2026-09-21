import type { AppliedCustomTheme } from "@/lib/vscode-theme"

/**
 * Imported themes the renderer has already converted, keyed by theme id.
 * Kept in localStorage next to the appearance snapshot so the very first
 * paint after launch can apply a custom theme without waiting for the
 * backend — the same reason the built-in templates are applied from the
 * snapshot. The backend copy (`<dataDir>/themes/`) stays the source of
 * truth; this is a cache and is rebuilt from it when missing.
 */
const STORAGE_KEY = "betterc0de-custom-themes"

type CacheShape = Record<string, AppliedCustomTheme>

export function readCustomThemes(
  storage: Pick<Storage, "getItem"> | null = safeStorage()
): CacheShape {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: CacheShape = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isAppliedTheme(value) && value.id === id) out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

export function getCustomTheme(id: string | null | undefined): AppliedCustomTheme | null {
  if (!id) return null
  return readCustomThemes()[id] ?? null
}

export function writeCustomTheme(theme: AppliedCustomTheme): void {
  const all = readCustomThemes()
  all[theme.id] = theme
  persist(all)
}

export function removeCustomTheme(id: string): void {
  const all = readCustomThemes()
  if (!(id in all)) return
  delete all[id]
  persist(all)
}

function persist(all: CacheShape): void {
  try {
    safeStorage()?.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* Quota or blocked storage: the theme still applies for this session. */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function isAppliedTheme(value: unknown): value is AppliedCustomTheme {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === "string"
    && typeof record.name === "string"
    && (record.mode === "dark" || record.mode === "light")
    && !!record.vars
    && typeof record.vars === "object"
    && !!record.monaco
    && typeof record.monaco === "object"
  )
}
