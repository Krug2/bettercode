import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { isRecord, parseJsonc } from "@betterc0de/schema"

/**
 * A color theme an installed editor already ships or the user installed as an
 * extension. Found by reading each extension's `package.json` manifest —
 * `contributes.themes[]` names the label, the `uiTheme` family and the theme
 * file. Cursor is a VS Code fork with the same layout under its own dirs.
 */
export interface InstalledTheme {
  /** Stable across scans: `<app>:<extensionId>:<label>`. */
  readonly id: string
  readonly label: string
  readonly app: "vscode" | "cursor"
  /** `publisher.name` from the manifest, or the folder name. */
  readonly extensionId: string
  readonly extensionName: string
  /** `vs`, `vs-dark`, `hc-black`, `hc-light`. */
  readonly uiTheme: string | null
  /** Absolute path of the theme JSON; only ever used on this machine. */
  readonly path: string
}

export interface InstalledThemeScanRoots {
  /** Per-user extension directories (`~/.vscode/extensions`, …). */
  readonly userExtensionDirs: ReadonlyArray<{ app: InstalledTheme["app"]; dir: string }>
  /** Built-in extension directories inside the app installs. */
  readonly builtinExtensionDirs: ReadonlyArray<{ app: InstalledTheme["app"]; dir: string }>
}

/**
 * Where VS Code and Cursor keep extensions on this platform. Every entry is
 * a candidate; missing ones are skipped at scan time.
 */
export function defaultThemeScanRoots(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): InstalledThemeScanRoots {
  const userExtensionDirs = [
    { app: "vscode" as const, dir: path.join(home, ".vscode", "extensions") },
    { app: "vscode" as const, dir: path.join(home, ".vscode-insiders", "extensions") },
    { app: "cursor" as const, dir: path.join(home, ".cursor", "extensions") },
  ]
  const builtin: Array<{ app: InstalledTheme["app"]; dir: string }> = []
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    const programFiles = env.ProgramFiles ?? "C:\\Program Files"
    builtin.push(
      { app: "vscode", dir: path.join(localAppData, "Programs", "Microsoft VS Code", "resources", "app", "extensions") },
      { app: "vscode", dir: path.join(programFiles, "Microsoft VS Code", "resources", "app", "extensions") },
      { app: "vscode", dir: path.join(localAppData, "Programs", "Microsoft VS Code Insiders", "resources", "app", "extensions") },
      { app: "cursor", dir: path.join(localAppData, "Programs", "cursor", "resources", "app", "extensions") },
      { app: "cursor", dir: path.join(programFiles, "cursor", "resources", "app", "extensions") },
    )
  } else if (platform === "darwin") {
    builtin.push(
      { app: "vscode", dir: "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions" },
      { app: "vscode", dir: path.join(home, "Applications", "Visual Studio Code.app", "Contents", "Resources", "app", "extensions") },
      { app: "cursor", dir: "/Applications/Cursor.app/Contents/Resources/app/extensions" },
      { app: "cursor", dir: path.join(home, "Applications", "Cursor.app", "Contents", "Resources", "app", "extensions") },
    )
  } else {
    builtin.push(
      { app: "vscode", dir: "/usr/share/code/resources/app/extensions" },
      { app: "vscode", dir: "/usr/lib/code/extensions" },
      { app: "vscode", dir: "/snap/code/current/usr/share/code/resources/app/extensions" },
      { app: "vscode", dir: "/opt/visual-studio-code/resources/app/extensions" },
      { app: "cursor", dir: "/opt/Cursor/resources/app/extensions" },
      { app: "cursor", dir: "/usr/share/cursor/resources/app/extensions" },
    )
  }
  return { userExtensionDirs, builtinExtensionDirs: builtin }
}

/**
 * Newer Windows builds of VS Code install into a per-build folder
 * (`Microsoft VS Code/<hash>/resources/app/extensions`). When the plain
 * layout is missing, look one level down for it.
 */
function expandBuiltinExtensionDir(dir: string): string[] {
  if (fs.existsSync(dir)) return [dir]
  const marker = path.join("resources", "app", "extensions")
  if (!dir.endsWith(marker)) return []
  const appDir = dir.slice(0, -marker.length - 1)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(appDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appDir, entry.name, marker))
    .filter((candidate) => fs.existsSync(candidate))
}

interface ManifestTheme {
  label?: unknown
  uiTheme?: unknown
  path?: unknown
}

function readJsonObject(file: string): Record<string, unknown> | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = parseJsonc(raw)
  } catch {
    return null
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

/**
 * Manifest strings may be "%key%" placeholders that package.nls.json (the
 * English bundle) fills in; VS Code's own theme-defaults names every theme
 * that way. Unresolvable placeholders fall back to the given default.
 */
function resolveNls(
  value: unknown,
  nls: Record<string, unknown> | null,
  fallback: string
): string {
  if (typeof value !== "string" || !value.trim()) return fallback
  const trimmed = value.trim()
  const match = /^%(.+)%$/.exec(trimmed)
  if (!match) return trimmed
  const resolved = nls?.[match[1]]
  return typeof resolved === "string" && resolved.trim() ? resolved.trim() : fallback
}

function readManifestThemes(manifestPath: string): {
  extensionId: string
  extensionName: string
  themes: ManifestTheme[]
  nls: Record<string, unknown> | null
} | null {
  const record = readJsonObject(manifestPath)
  if (!record) return null
  const contributes = record.contributes as Record<string, unknown> | undefined
  const themes = contributes?.themes
  if (!Array.isArray(themes) || themes.length === 0) return null
  const nls = readJsonObject(path.join(path.dirname(manifestPath), "package.nls.json"))
  const name = typeof record.name === "string" ? record.name : path.basename(path.dirname(manifestPath))
  const publisher = typeof record.publisher === "string" ? record.publisher : null
  return {
    extensionId: publisher ? `${publisher}.${name}` : name,
    extensionName: resolveNls(record.displayName, nls, name),
    themes: themes.filter(isRecord),
    nls,
  }
}

/**
 * Scans every candidate directory and lists the color themes it finds.
 * Read-only, tolerant of anything missing or malformed, capped so a huge
 * extension folder cannot stall the request.
 */
export function discoverInstalledThemes(
  roots: InstalledThemeScanRoots = defaultThemeScanRoots(),
  limits: { maxExtensions?: number } = {}
): InstalledTheme[] {
  const maxExtensions = limits.maxExtensions ?? 2_000
  const found = new Map<string, InstalledTheme>()
  let visited = 0
  const scan = (app: InstalledTheme["app"], dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited >= maxExtensions) return
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      visited++
      const extensionDir = path.join(dir, entry.name)
      const manifest = readManifestThemes(path.join(extensionDir, "package.json"))
      if (!manifest) continue
      for (const theme of manifest.themes) {
        if (typeof theme.path !== "string" || !theme.path.trim()) continue
        const themePath = path.resolve(extensionDir, theme.path)
        // Never follow a manifest out of its own extension folder.
        if (!themePath.startsWith(extensionDir + path.sep)) continue
        if (!fs.existsSync(themePath)) continue
        const label = resolveNls(
          theme.label,
          manifest.nls,
          path.basename(themePath).replace(/\.json$/i, "")
        )
        const id = `${app}:${manifest.extensionId}:${label}`
        if (found.has(id)) continue
        found.set(id, {
          id,
          label,
          app,
          extensionId: manifest.extensionId,
          extensionName: manifest.extensionName,
          uiTheme: typeof theme.uiTheme === "string" ? theme.uiTheme : null,
          path: themePath,
        })
      }
    }
  }
  for (const root of roots.builtinExtensionDirs) {
    for (const dir of expandBuiltinExtensionDir(root.dir)) scan(root.app, dir)
  }
  for (const root of roots.userExtensionDirs) scan(root.app, root.dir)
  return [...found.values()].sort((a, b) =>
    a.app === b.app ? a.label.localeCompare(b.label) : a.app.localeCompare(b.app)
  )
}
