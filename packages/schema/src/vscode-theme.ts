import { asRecord, isRecord } from "./json-read"

/**
 * VS Code color themes — the format VS Code, Cursor (a VS Code fork) and
 * every custom theme on the marketplace share. A theme file is JSONC: line
 * and block comments and trailing commas are allowed, so `JSON.parse` alone
 * rejects most real files. This module parses that dialect and reduces a
 * theme to the parts BetterC0de renders: workbench `colors`, TextMate
 * `tokenColors` and `semanticTokenColors`. No filesystem here; resolving an
 * `include` chain is the caller's job (see `mergeVsCodeThemeInclude`).
 */

export type VsCodeThemeMode = "dark" | "light"

export interface VsCodeTokenColor {
  readonly name?: string
  /** One or more TextMate scopes; a single string may be comma-separated. */
  readonly scope: readonly string[]
  readonly settings: {
    readonly foreground?: string
    readonly background?: string
    readonly fontStyle?: string
  }
}

export interface VsCodeThemeSource {
  readonly name?: string
  readonly type?: string
  /** Relative path of a parent theme this one layers on top of. */
  readonly include?: string
  readonly colors: Record<string, string>
  readonly tokenColors: readonly VsCodeTokenColor[]
  readonly semanticTokenColors: Record<string, unknown>
  readonly semanticHighlighting?: boolean
}

/** What BetterC0de stores for an imported theme. */
export interface ImportedTheme {
  readonly id: string
  readonly name: string
  readonly mode: VsCodeThemeMode
  /** Where it came from, for the list in Settings. */
  readonly source: ImportedThemeSource
  readonly colors: Record<string, string>
  readonly tokenColors: readonly VsCodeTokenColor[]
  readonly semanticTokenColors: Record<string, unknown>
  readonly semanticHighlighting: boolean
  readonly importedAt: string
}

export interface ImportedThemeSource {
  readonly kind: "vscode" | "cursor" | "file" | "paste"
  /** Extension id or file name; never a full path (it may be shown remotely). */
  readonly label: string
}

/** The listing shape: everything but the (large) color tables. */
export interface ImportedThemeSummary {
  readonly id: string
  readonly name: string
  readonly mode: VsCodeThemeMode
  readonly source: ImportedThemeSource
  readonly importedAt: string
  /** Three swatches for the picker card. */
  readonly preview: { readonly bg: string; readonly sidebar: string; readonly accent: string }
}

export class VsCodeThemeParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VsCodeThemeParseError"
  }
}

const MAX_THEME_BYTES = 4 * 1024 * 1024

/**
 * JSONC → JSON text. Strips `//` and `/* *\/` comments and trailing commas
 * while leaving string contents alone (a `//` inside a scope name or a
 * `#` color is data). A UTF-8 BOM is dropped as well.
 */
export function stripJsonc(text: string): string {
  let out = ""
  let i = 0
  if (text.charCodeAt(0) === 0xfeff) i = 1
  const n = text.length
  while (i < n) {
    const ch = text[i]!
    if (ch === '"') {
      // Copy the string verbatim, honouring escapes.
      let j = i + 1
      while (j < n) {
        const c = text[j]!
        if (c === "\\") {
          j += 2
          continue
        }
        if (c === '"') break
        j++
      }
      out += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++
      continue
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      if (end === -1) throw new VsCodeThemeParseError("Unterminated JSON comment")
      // Comments separate tokens; removing them must not turn `1/*x*/2` into 12.
      out += " "
      i = end + 2
      continue
    }
    if (ch === ",") {
      // Trailing comma: next significant char closes the container.
      let j = i + 1
      while (j < n) {
        if (/\s/.test(text[j]!)) {
          j++
        } else if (text[j] === "/" && text[j + 1] === "/") {
          while (j < n && text[j] !== "\n") j++
        } else if (text[j] === "/" && text[j + 1] === "*") {
          const end = text.indexOf("*/", j + 2)
          if (end === -1) throw new VsCodeThemeParseError("Unterminated JSON comment")
          j = end + 2
        } else {
          break
        }
      }
      if (text[j] === "}" || text[j] === "]") {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/** Parses JSONC into a plain value; throws `VsCodeThemeParseError` with a usable message. */
export function parseJsonc(text: string): unknown {
  if (text.length > MAX_THEME_BYTES) {
    throw new VsCodeThemeParseError("Theme file is larger than 4 MB")
  }
  try {
    return JSON.parse(stripJsonc(text))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new VsCodeThemeParseError(`Not valid theme JSON: ${reason}`)
  }
}

function readColorMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(asRecord(value))) {
    if (typeof raw === "string" && isCssColor(raw)) out[key] = raw.trim()
  }
  return out
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` — the forms VS Code themes use. */
export function isCssColor(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())
}

function readTokenColors(value: unknown): VsCodeTokenColor[] {
  if (!Array.isArray(value)) return []
  const out: VsCodeTokenColor[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const settings = asRecord(entry.settings)
    const scope = entry.scope
    const scopes = Array.isArray(scope)
      ? scope.filter((s): s is string => typeof s === "string")
      : typeof scope === "string"
        ? scope.split(",").map((s) => s.trim()).filter(Boolean)
        : // A rule without a scope is the editor default (foreground/background).
          []
    const foreground =
      typeof settings.foreground === "string" && isCssColor(settings.foreground)
        ? settings.foreground.trim()
        : undefined
    const background =
      typeof settings.background === "string" && isCssColor(settings.background)
        ? settings.background.trim()
        : undefined
    const fontStyle =
      typeof settings.fontStyle === "string" ? settings.fontStyle.trim() : undefined
    if (!foreground && !background && fontStyle === undefined) continue
    out.push({
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      scope: scopes,
      settings: {
        ...(foreground ? { foreground } : {}),
        ...(background ? { background } : {}),
        ...(fontStyle !== undefined ? { fontStyle } : {}),
      },
    })
  }
  return out
}

/** Reads the parts of a theme object we keep. Tolerates any junk around them. */
export function readVsCodeThemeSource(value: unknown): VsCodeThemeSource {
  const record = asRecord(value)
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(typeof record.include === "string" ? { include: record.include } : {}),
    colors: readColorMap(record.colors),
    tokenColors: readTokenColors(record.tokenColors),
    semanticTokenColors: asRecord(record.semanticTokenColors) as Record<string, unknown>,
    ...(typeof record.semanticHighlighting === "boolean"
      ? { semanticHighlighting: record.semanticHighlighting }
      : {}),
  }
}

/** Parse text straight to a theme source. */
export function parseVsCodeThemeSource(text: string): VsCodeThemeSource {
  const value = parseJsonc(text)
  if (!isRecord(value)) throw new VsCodeThemeParseError("Theme JSON must be an object")
  const source = readVsCodeThemeSource(value)
  if (
    Object.keys(source.colors).length === 0
    && source.tokenColors.length === 0
    && !source.include
  ) {
    throw new VsCodeThemeParseError(
      "No theme data found: expected \"colors\" or \"tokenColors\""
    )
  }
  return source
}

/**
 * Layer `child` over `parent` the way VS Code resolves `include`: the child's
 * colors win key by key, its token rules come after the parent's (later rules
 * win in TextMate), semantic colors merge key by key.
 */
export function mergeVsCodeThemeInclude(
  parent: VsCodeThemeSource,
  child: VsCodeThemeSource
): VsCodeThemeSource {
  const { include: _dropped, ...rest } = child
  return {
    ...parent,
    ...rest,
    colors: { ...parent.colors, ...child.colors },
    tokenColors: [...parent.tokenColors, ...child.tokenColors],
    semanticTokenColors: {
      ...parent.semanticTokenColors,
      ...child.semanticTokenColors,
    },
  }
}

/** Relative luminance of a `#rrggbb[aa]` color, 0..1; null for junk. */
export function hexLuminance(color: string): number | null {
  const rgb = parseHexColor(color)
  if (!rgb) return null
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

export function parseHexColor(
  color: string
): { r: number; g: number; b: number; a: number } | null {
  const raw = color.trim().replace(/^#/, "")
  if (!/^[0-9a-f]+$/i.test(raw)) return null
  let hex = raw
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split("").map((c) => c + c).join("")
  }
  if (hex.length !== 6 && hex.length !== 8) return null
  const int = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16)
  return {
    r: int(0),
    g: int(2),
    b: int(4),
    a: hex.length === 8 ? int(6) / 255 : 1,
  }
}

/**
 * Dark or light. `type` and the `uiTheme` hint from the extension manifest
 * are authoritative; without them the editor background decides.
 */
export function resolveVsCodeThemeMode(
  source: Pick<VsCodeThemeSource, "type" | "colors">,
  uiTheme?: string | null
): VsCodeThemeMode {
  const declared = (source.type ?? "").toLowerCase()
  if (declared === "light" || declared === "hc-light" || declared === "hclight") return "light"
  if (declared === "dark" || declared === "hc" || declared === "hc-black" || declared === "hcdark") return "dark"
  if (uiTheme === "vs" || uiTheme === "hc-light") return "light"
  if (uiTheme === "vs-dark" || uiTheme === "hc-black") return "dark"
  const bg = source.colors["editor.background"] ?? source.colors["editor.foreground"]
  const luminance = bg ? hexLuminance(bg) : null
  if (luminance === null) return "dark"
  // When only the foreground is known, a light foreground means a dark theme.
  return source.colors["editor.background"]
    ? luminance > 0.5 ? "light" : "dark"
    : luminance > 0.5 ? "dark" : "light"
}

/** URL-safe id from a name; the caller appends a suffix on collision. */
export function themeIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return slug || "theme"
}

export function summarizeImportedTheme(theme: ImportedTheme): ImportedThemeSummary {
  const c = theme.colors
  const fallbackBg = theme.mode === "dark" ? "#1e1e1e" : "#ffffff"
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    source: theme.source,
    importedAt: theme.importedAt,
    preview: {
      bg: c["editor.background"] ?? fallbackBg,
      sidebar: c["sideBar.background"] ?? c["activityBar.background"] ?? c["editor.background"] ?? fallbackBg,
      accent:
        c["button.background"]
        ?? c["focusBorder"]
        ?? c["activityBarBadge.background"]
        ?? c["editorCursor.foreground"]
        ?? (theme.mode === "dark" ? "#e8e8e8" : "#1a1a1a"),
    },
  }
}
