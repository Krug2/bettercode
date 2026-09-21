import fs from "node:fs"
import path from "node:path"
import {
  isRecord,
  mergeVsCodeThemeInclude,
  parseVsCodeThemeSource,
  readVsCodeThemeSource,
  resolveVsCodeThemeMode,
  summarizeImportedTheme,
  themeIdFromName,
  VsCodeThemeParseError,
  type ImportedTheme,
  type ImportedThemeSource,
  type ImportedThemeSummary,
  type VsCodeThemeSource,
} from "@betterc0de/schema"
import { discoverInstalledThemes, type InstalledTheme } from "./installed"

/**
 * Imported themes live as one JSON file each under `<dataDir>/themes/`.
 * Nothing else is derived on the backend: the renderer maps a theme to CSS
 * tokens and editor rules itself, so a theme survives renderer changes.
 * Files are written atomically (temp + rename) — a crash mid-import must
 * not leave a half theme that the settings page then fails to list.
 */
export class ThemeStore {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "themes")
  }

  list(): ImportedThemeSummary[] {
    return this.readAll().map(summarizeImportedTheme)
  }

  get(id: string): ImportedTheme | null {
    const file = this.fileFor(id)
    if (!file) return null
    try {
      return readThemeFile(file)
    } catch {
      return null
    }
  }

  delete(id: string): boolean {
    const file = this.fileFor(id)
    if (!file) return false
    try {
      fs.rmSync(file)
      return true
    } catch {
      return false
    }
  }

  /** Import from theme text (a picked file or pasted JSON). */
  importText(input: {
    text: string
    name?: string
    source: ImportedThemeSource
  }): ImportedTheme {
    const parsed = parseVsCodeThemeSource(input.text)
    if (parsed.include) {
      throw new VsCodeThemeParseError(
        `This theme includes "${parsed.include}", which cannot be resolved from pasted text. Import it from the installed editor instead.`
      )
    }
    return this.save(parsed, {
      name: input.name?.trim() || parsed.name || "Imported theme",
      source: input.source,
      uiTheme: null,
    })
  }

  /** Import a theme discovered on this machine, resolving its include chain. */
  importInstalled(theme: InstalledTheme): ImportedTheme {
    const source = loadThemeWithIncludes(theme.path)
    return this.save(source, {
      name: theme.label,
      source: { kind: theme.app, label: theme.extensionId },
      uiTheme: theme.uiTheme,
    })
  }

  /** Re-scan the installed editors; a pure read of their extension folders. */
  installed(): InstalledTheme[] {
    return discoverInstalledThemes()
  }

  private save(
    source: VsCodeThemeSource,
    meta: { name: string; source: ImportedThemeSource; uiTheme: string | null }
  ): ImportedTheme {
    const theme: ImportedTheme = {
      id: this.uniqueId(themeIdFromName(meta.name)),
      name: meta.name.slice(0, 120),
      mode: resolveVsCodeThemeMode(source, meta.uiTheme),
      source: meta.source,
      colors: source.colors,
      tokenColors: source.tokenColors,
      semanticTokenColors: source.semanticTokenColors,
      semanticHighlighting: source.semanticHighlighting ?? false,
      importedAt: new Date().toISOString(),
    }
    fs.mkdirSync(this.dir, { recursive: true })
    const target = path.join(this.dir, `${theme.id}.json`)
    const temp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(theme), "utf8")
    fs.renameSync(temp, target)
    return theme
  }

  private uniqueId(base: string): string {
    const existing = new Set(this.readAll().map((theme) => theme.id))
    if (!existing.has(base)) return base
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}-${n}`
      if (!existing.has(candidate)) return candidate
    }
    return `${base}-${Date.now()}`
  }

  private fileFor(id: string): string | null {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) return null
    const file = path.join(this.dir, `${id}.json`)
    return fs.existsSync(file) ? file : null
  }

  private readAll(): ImportedTheme[] {
    let names: string[]
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    const themes: ImportedTheme[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      try {
        themes.push(readThemeFile(path.join(this.dir, name)))
      } catch {
        // A damaged file is skipped, not fatal for the list.
      }
    }
    return themes.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    )
  }
}

function readThemeFile(file: string): ImportedTheme {
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
  if (
    !isRecord(raw)
    || typeof raw.id !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw.id)
    || raw.id !== path.basename(file, ".json")
    || typeof raw.name !== "string"
    || (raw.mode !== "dark" && raw.mode !== "light")
    || !isRecord(raw.source)
    || (raw.source.kind !== "vscode" && raw.source.kind !== "cursor"
      && raw.source.kind !== "file" && raw.source.kind !== "paste")
    || typeof raw.source.label !== "string"
    || typeof raw.importedAt !== "string"
    || !Number.isFinite(Date.parse(raw.importedAt))
  ) {
    throw new Error(`Not an imported theme: ${path.basename(file)}`)
  }
  // Disk records are untrusted too. Reuse the import normalizer for optional
  // color tables so older records and damaged rules cannot reach the renderer.
  const source = readVsCodeThemeSource(raw)
  return {
    id: raw.id,
    name: raw.name,
    mode: raw.mode,
    source: { kind: raw.source.kind, label: raw.source.label },
    importedAt: raw.importedAt,
    colors: source.colors,
    tokenColors: source.tokenColors,
    semanticTokenColors: source.semanticTokenColors,
    semanticHighlighting: source.semanticHighlighting ?? false,
  }
}

const MAX_INCLUDE_DEPTH = 8

/**
 * Reads a theme file and layers it over its `include` parents. Includes are
 * relative to the including file and must stay inside that file's directory
 * tree, exactly as VS Code resolves them.
 */
export function loadThemeWithIncludes(file: string, depth = 0): VsCodeThemeSource {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new VsCodeThemeParseError("Theme include chain is too deep")
  }
  const text = fs.readFileSync(file, "utf8")
  const source = parseVsCodeThemeSource(text)
  if (!source.include) return source
  const parentPath = path.resolve(path.dirname(file), source.include)
  const parent = loadThemeWithIncludes(parentPath, depth + 1)
  return mergeVsCodeThemeInclude(parent, source)
}
