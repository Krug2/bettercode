import {
  parseHexColor,
  type ImportedTheme,
  type VsCodeThemeMode,
  type VsCodeTokenColor,
} from "@betterc0de/schema"

/**
 * From a VS Code theme to the three things BetterC0de paints with:
 *
 * 1. the workbench CSS tokens in `index.css` (`--background`, `--sidebar`, …),
 * 2. a Monaco theme for the editor (Monarch tokens, not TextMate scopes, so
 *    the scopes are folded onto Monaco's token families), and
 * 3. the theme itself for shiki, which reads VS Code themes natively and
 *    highlights chat code blocks with full fidelity.
 *
 * Everything here is pure: the same input always yields the same output,
 * and nothing touches the DOM. `appearance-store` applies the result.
 */

export const CUSTOM_TEMPLATE_PREFIX = "custom:"

export function customTemplateId(themeId: string): string {
  return CUSTOM_TEMPLATE_PREFIX + themeId
}

export function isCustomTemplateId(templateId: string | undefined | null): boolean {
  return typeof templateId === "string" && templateId.startsWith(CUSTOM_TEMPLATE_PREFIX)
}

export function customThemeIdOf(templateId: string): string | null {
  return isCustomTemplateId(templateId)
    ? templateId.slice(CUSTOM_TEMPLATE_PREFIX.length)
    : null
}

// ── Color helpers ─────────────────────────────────────────────────────

type Rgb = { r: number; g: number; b: number }

function rgbOf(hex: string | undefined): Rgb | null {
  if (!hex) return null
  const parsed = parseHexColor(hex)
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : null
}

function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Mix `a` towards `b` by `t` (0..1). */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/** Lift a surface towards the foreground pole of its mode. */
function lift(base: Rgb, mode: VsCodeThemeMode, amount: number): string {
  return toHex(mix(base, mode === "dark" ? WHITE : BLACK, amount))
}

/** `#rrggbb` + alpha as an 8-digit hex, the form every consumer accepts. */
function withAlpha(hex: string, alpha: number): string {
  const rgb = rgbOf(hex)
  if (!rgb) return hex
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")
  return `${toHex(rgb)}${a}`
}

/** A theme color that VS Code themes may write with an alpha channel; opaque hex out. */
function opaque(hex: string | undefined): string | undefined {
  const rgb = rgbOf(hex)
  return rgb ? toHex(rgb) : undefined
}

// ── Workbench tokens ──────────────────────────────────────────────────

/**
 * Map VS Code workbench colors onto our tokens. Each token takes the first
 * of several VS Code keys a theme is likely to define, and falls back to a
 * value derived from the editor background so a minimal theme (colors for
 * the editor only) still produces a complete, coherent workbench.
 */
export function themeToCssVars(
  theme: Pick<ImportedTheme, "colors" | "mode">
): Record<string, string> {
  const c = theme.colors
  const mode = theme.mode
  const first = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = opaque(c[key])
      if (value) return value
    }
    return undefined
  }

  const background = first("editor.background") ?? (mode === "dark" ? "#1e1e1e" : "#ffffff")
  const bgRgb = rgbOf(background)!
  const foreground =
    first("editor.foreground", "foreground") ?? (mode === "dark" ? "#d4d4d4" : "#1f1f1f")
  const fgRgb = rgbOf(foreground)!

  const sidebar = first("sideBar.background", "activityBar.background") ?? lift(bgRgb, mode, 0.03)
  const sidebarForeground = first("sideBar.foreground", "foreground") ?? foreground
  const card =
    first("editorWidget.background", "dropdown.background", "menu.background", "quickInput.background")
    ?? lift(bgRgb, mode, 0.06)
  const cardForeground = first("editorWidget.foreground", "menu.foreground") ?? foreground
  const muted = first("list.hoverBackground", "toolbar.hoverBackground") ?? lift(bgRgb, mode, 0.1)
  const mutedForeground =
    first("descriptionForeground", "disabledForeground", "editorLineNumber.foreground")
    ?? toHex(mix(fgRgb, bgRgb, 0.35))
  const accent =
    first("list.inactiveSelectionBackground", "list.hoverBackground") ?? lift(bgRgb, mode, 0.1)
  const primary =
    first("button.background", "focusBorder", "activityBarBadge.background", "textLink.foreground")
    ?? (mode === "dark" ? "#e8e8e8" : "#1a1a1a")
  const primaryRgb = rgbOf(primary)!
  const primaryLuminance = (0.2126 * primaryRgb.r + 0.7152 * primaryRgb.g + 0.0722 * primaryRgb.b) / 255
  const primaryForeground =
    first("button.foreground") ?? (primaryLuminance > 0.6 ? "#111111" : "#ffffff")
  const border = first("panel.border", "sideBar.border", "widget.border", "contrastBorder")
  const input = first("input.background")
  const ring = first("focusBorder") ?? primary
  const destructive =
    first("errorForeground", "editorError.foreground", "inputValidation.errorBorder")
    ?? (mode === "dark" ? "#f87171" : "#dc2626")
  const sidebarPrimary = first("activityBarBadge.background", "badge.background") ?? primary
  const sidebarPrimaryForeground =
    first("activityBarBadge.foreground", "badge.foreground") ?? primaryForeground

  return {
    "--background": background,
    "--foreground": foreground,
    "--card": card,
    "--card-foreground": cardForeground,
    "--popover": card,
    "--popover-foreground": cardForeground,
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--secondary": muted,
    "--secondary-foreground": foreground,
    "--muted": muted,
    "--muted-foreground": mutedForeground,
    "--accent": accent,
    "--accent-foreground": foreground,
    "--destructive": destructive,
    // Borders stay translucent so they read on every surface of the theme.
    "--border": border ? withAlpha(border, 0.6) : withAlpha(foreground, mode === "dark" ? 0.1 : 0.12),
    "--input": input ?? withAlpha(foreground, mode === "dark" ? 0.15 : 0.1),
    "--ring": ring,
    "--sidebar": sidebar,
    "--sidebar-foreground": sidebarForeground,
    "--sidebar-primary": sidebarPrimary,
    "--sidebar-primary-foreground": sidebarPrimaryForeground,
    "--sidebar-accent": first("list.hoverBackground") ?? lift(rgbOf(sidebar) ?? bgRgb, mode, 0.08),
    "--sidebar-accent-foreground": sidebarForeground,
    "--sidebar-border": first("sideBar.border")
      ? withAlpha(first("sideBar.border")!, 0.6)
      : withAlpha(sidebarForeground, mode === "dark" ? 0.1 : 0.12),
  }
}

// ── Monaco ────────────────────────────────────────────────────────────

/**
 * TextMate scope prefix → Monaco token names, most specific first. Monaco
 * matches a rule when its token is a *prefix* of the tokenizer's token
 * (`keyword` matches `keyword.json`), and its Monarch tokenizers only emit a
 * small family of names, so `keyword.control.flow` has to become `keyword`
 * to have any effect. Later rules in a theme override earlier ones, which
 * is also how VS Code applies them.
 */
const SCOPE_TO_MONACO: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["comment.block.documentation", ["comment.doc"]],
  ["comment", ["comment"]],
  ["string.regexp", ["regexp"]],
  ["string", ["string"]],
  ["constant.numeric", ["number"]],
  ["constant.character.escape", ["string.escape"]],
  ["constant.language", ["keyword.constant", "constant"]],
  ["constant.other", ["constant"]],
  ["constant", ["constant"]],
  ["storage.type", ["keyword", "type"]],
  ["storage.modifier", ["keyword"]],
  ["storage", ["keyword"]],
  ["keyword.operator", ["operator", "delimiter"]],
  ["keyword.control", ["keyword"]],
  ["keyword.other", ["keyword"]],
  ["keyword", ["keyword"]],
  ["entity.name.type", ["type", "type.identifier"]],
  ["entity.name.class", ["type", "type.identifier"]],
  ["entity.name.namespace", ["namespace"]],
  ["entity.name.function", ["identifier.function", "function"]],
  ["entity.name.tag", ["tag"]],
  ["entity.name.section", ["keyword"]],
  ["entity.other.attribute-name", ["attribute.name"]],
  ["entity.other.inherited-class", ["type"]],
  ["support.type", ["type"]],
  ["support.class", ["type"]],
  ["support.function", ["identifier.function", "function"]],
  ["support.variable", ["variable"]],
  ["support.constant", ["constant"]],
  ["variable.parameter", ["variable.parameter"]],
  ["variable.language", ["variable.predefined", "keyword"]],
  ["variable.other.property", ["variable.property"]],
  ["variable", ["variable", "identifier"]],
  ["meta.tag", ["tag"]],
  ["meta.attribute", ["attribute.name"]],
  ["punctuation.definition.tag", ["delimiter.html", "tag"]],
  ["punctuation.definition.comment", ["comment"]],
  ["punctuation", ["delimiter"]],
  ["markup.heading", ["keyword"]],
  ["markup.bold", ["strong"]],
  ["markup.italic", ["emphasis"]],
  ["markup.inline.raw", ["string"]],
  ["markup.underline.link", ["string.link"]],
  ["markup.quote", ["comment"]],
  ["markup.list", ["keyword"]],
  ["markup.inserted", ["string"]],
  ["markup.deleted", ["invalid"]],
  ["invalid", ["invalid"]],
  ["source.json meta.structure.dictionary.json support.type.property-name", ["string.key.json"]],
  ["support.type.property-name.json", ["string.key.json"]],
  ["support.type.property-name", ["attribute.name", "string.key.json"]],
  ["meta.embedded", ["source"]],
]

export interface MonacoThemeRule {
  token: string
  foreground?: string
  background?: string
  fontStyle?: string
}

export interface MonacoThemeData {
  base: "vs" | "vs-dark" | "hc-black" | "hc-light"
  inherit: boolean
  rules: MonacoThemeRule[]
  colors: Record<string, string>
}

function monacoTokensForScope(scope: string): readonly string[] {
  const trimmed = scope.trim()
  if (!trimmed) return []
  // A scope selector may be a path ("source.js meta.function entity.name");
  // the last segment is the token itself.
  const leaf = trimmed.split(/\s+/).pop()!.replace(/^[>~+]\s*/, "")
  // The most specific prefix wins ("support.type.property-name" over
  // "support.type"), and a match on the full selector beats one on its leaf.
  let best: { tokens: readonly string[]; length: number; full: boolean } | null = null
  const matches = (subject: string, prefix: string) =>
    subject === prefix || subject.startsWith(prefix + ".") || subject.startsWith(prefix + " ")
  for (const [prefix, tokens] of SCOPE_TO_MONACO) {
    const full = matches(trimmed, prefix)
    if (!full && !matches(leaf, prefix)) continue
    if (
      !best ||
      prefix.length > best.length ||
      (prefix.length === best.length && full && !best.full)
    ) {
      best = { tokens, length: prefix.length, full }
    }
  }
  return best?.tokens ?? []
}

/** Monaco wants bare 6/8-digit hex without the `#`. */
function monacoHex(color: string | undefined): string | undefined {
  if (!color) return undefined
  const parsed = parseHexColor(color)
  if (!parsed) return undefined
  const rgb = toHex(parsed).slice(1)
  return parsed.a < 1 ? rgb + Math.round(parsed.a * 255).toString(16).padStart(2, "0") : rgb
}

/** Color ids Monaco's standalone editor knows; anything else it ignores. */
const MONACO_COLOR_PREFIXES = [
  "editor",
  "editorCursor",
  "editorGutter",
  "editorLineNumber",
  "editorWhitespace",
  "editorIndentGuide",
  "editorBracket",
  "editorWidget",
  "editorSuggestWidget",
  "editorHoverWidget",
  "editorLink",
  "editorError",
  "editorWarning",
  "editorInfo",
  "editorOverviewRuler",
  "editorStickyScroll",
  "editorInlayHint",
  "editorCodeLens",
  "editorRuler",
  "diffEditor",
  "peekView",
  "scrollbar",
  "scrollbarSlider",
  "minimap",
  "input",
  "list",
  "quickInput",
  "widget",
  "focusBorder",
  "foreground",
  "selection",
  "textLink",
  "menu",
  "badge",
  "button",
]

export function themeToMonaco(
  theme: Pick<ImportedTheme, "colors" | "tokenColors" | "mode">
): MonacoThemeData {
  const rules: MonacoThemeRule[] = []
  const seen = new Set<string>()
  const defaultRule = theme.tokenColors.find((rule) => rule.scope.length === 0)
  const pushRule = (token: string, settings: VsCodeTokenColor["settings"]) => {
    const rule: MonacoThemeRule = { token }
    const fg = monacoHex(settings.foreground)
    const bg = monacoHex(settings.background)
    if (fg) rule.foreground = fg
    if (bg) rule.background = bg
    if (settings.fontStyle !== undefined) rule.fontStyle = settings.fontStyle
    if (!rule.foreground && !rule.background && rule.fontStyle === undefined) return
    // Later theme rules win: replace an earlier rule for the same token.
    const key = token
    if (seen.has(key)) {
      const index = rules.findIndex((existing) => existing.token === token)
      if (index >= 0) rules.splice(index, 1)
    }
    seen.add(key)
    rules.push(rule)
  }
  for (const rule of theme.tokenColors) {
    if (rule.scope.length === 0) continue
    for (const scope of rule.scope) {
      for (const token of monacoTokensForScope(scope)) pushRule(token, rule.settings)
    }
  }

  const colors: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme.colors)) {
    if (!MONACO_COLOR_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix + "."))) continue
    const hex = monacoHex(value)
    if (hex) colors[key] = "#" + hex
  }
  // A theme's default token rule names the editor colors when the workbench
  // section forgot to; Monaco requires editor.background/foreground.
  const bg = monacoHex(theme.colors["editor.background"] ?? defaultRule?.settings.background)
  const fg = monacoHex(theme.colors["editor.foreground"] ?? defaultRule?.settings.foreground)
  if (bg) colors["editor.background"] = "#" + bg
  if (fg) colors["editor.foreground"] = "#" + fg
  if (defaultRule && !colors["editor.foreground"] && monacoHex(defaultRule.settings.foreground)) {
    colors["editor.foreground"] = "#" + monacoHex(defaultRule.settings.foreground)!
  }

  return {
    base: theme.mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules,
    colors,
  }
}

// ── shiki ─────────────────────────────────────────────────────────────

/** shiki takes a VS Code theme as-is; only the name has to be unique. */
export function themeToShiki(theme: Pick<ImportedTheme, "id" | "name" | "mode" | "colors" | "tokenColors" | "semanticTokenColors">) {
  return {
    name: shikiThemeName(theme.id),
    displayName: theme.name,
    type: theme.mode,
    colors: theme.colors,
    tokenColors: theme.tokenColors.map((rule) => ({
      ...(rule.name ? { name: rule.name } : {}),
      scope: [...rule.scope],
      settings: { ...rule.settings },
    })),
    semanticTokenColors: theme.semanticTokenColors,
  }
}

export function shikiThemeName(themeId: string): string {
  return `betterc0de-${themeId}`
}

// ── The applied bundle the renderer caches ────────────────────────────

/** What the appearance store keeps per imported theme, so boot is instant. */
export interface AppliedCustomTheme {
  id: string
  name: string
  mode: VsCodeThemeMode
  vars: Record<string, string>
  monaco: MonacoThemeData
  shiki: ReturnType<typeof themeToShiki>
}

export function buildAppliedCustomTheme(theme: ImportedTheme): AppliedCustomTheme {
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    vars: themeToCssVars(theme),
    monaco: themeToMonaco(theme),
    shiki: themeToShiki(theme),
  }
}
