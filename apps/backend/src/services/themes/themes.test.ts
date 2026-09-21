import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  hexLuminance,
  mergeVsCodeThemeInclude,
  parseVsCodeThemeSource,
  resolveVsCodeThemeMode,
  stripJsonc,
  summarizeImportedTheme,
  themeIdFromName,
} from "@betterc0de/schema"
import { defaultThemeScanRoots, discoverInstalledThemes } from "./installed"
import { loadThemeWithIncludes, ThemeStore } from "./store"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A slice of VS Code's own "Dark Modern": JSONC with comments, trailing
// commas and a BOM, exactly as the files ship.
const DARK_MODERN = `\uFEFF{
  // Dark Modern
  "$schema": "vscode://schemas/color-theme",
  "name": "Dark Modern",
  "type": "dark",
  "colors": {
    "editor.background": "#1F1F1F",
    "editor.foreground": "#CCCCCC",
    "sideBar.background": "#181818",
    "button.background": "#0078D4", /* accent */
    "focusBorder": "#0078D4",
    "not-a-color": "red",
  },
  "tokenColors": [
    { "scope": "comment", "settings": { "foreground": "#6A9955" } },
    { "name": "Keywords", "scope": ["keyword", "storage.type"], "settings": { "foreground": "#569CD6", "fontStyle": "bold" } },
    { "scope": "string, meta.embedded.assembly", "settings": { "foreground": "#CE9178" } },
    { "scope": "junk", "settings": {} },
  ],
  "semanticTokenColors": { "newOperator": "#C586C0" },
  "semanticHighlighting": true,
}`

describe("VS Code theme parsing", () => {
  it("accepts JSONC and keeps only well-formed colors and rules", () => {
    expect(JSON.parse(stripJsonc('{"a": "http://x", /* c */ "b": [1,2,],}'))).toEqual({
      a: "http://x",
      b: [1, 2],
    })
    const theme = parseVsCodeThemeSource(DARK_MODERN)
    expect(theme.name).toBe("Dark Modern")
    expect(theme.colors).toEqual({
      "editor.background": "#1F1F1F",
      "editor.foreground": "#CCCCCC",
      "sideBar.background": "#181818",
      "button.background": "#0078D4",
      focusBorder: "#0078D4",
    })
    expect(theme.tokenColors).toEqual([
      { scope: ["comment"], settings: { foreground: "#6A9955" } },
      {
        name: "Keywords",
        scope: ["keyword", "storage.type"],
        settings: { foreground: "#569CD6", fontStyle: "bold" },
      },
      { scope: ["string", "meta.embedded.assembly"], settings: { foreground: "#CE9178" } },
    ])
    expect(theme.semanticTokenColors).toEqual({ newOperator: "#C586C0" })
    expect(theme.semanticHighlighting).toBe(true)
  })

  it("rejects text that is not a theme with a message the user can act on", () => {
    expect(() => parseVsCodeThemeSource("{")).toThrow(/Not valid theme JSON/)
    expect(() => parseVsCodeThemeSource("[1,2]")).toThrow(/must be an object/)
    expect(() => parseVsCodeThemeSource('{"name":"x"}')).toThrow(/No theme data/)
  })

  it("decides dark or light from type, then the manifest hint, then the background", () => {
    expect(resolveVsCodeThemeMode({ type: "light", colors: {} })).toBe("light")
    expect(resolveVsCodeThemeMode({ type: "hc-black", colors: {} })).toBe("dark")
    expect(resolveVsCodeThemeMode({ colors: {} }, "vs")).toBe("light")
    expect(resolveVsCodeThemeMode({ colors: { "editor.background": "#fafafa" } })).toBe("light")
    expect(resolveVsCodeThemeMode({ colors: { "editor.background": "#1e1e1e" } })).toBe("dark")
    expect(resolveVsCodeThemeMode({ colors: { "editor.foreground": "#d4d4d4" } })).toBe("dark")
    expect(resolveVsCodeThemeMode({ colors: {} })).toBe("dark")
    expect(hexLuminance("#fff")).toBeCloseTo(1, 5)
    expect(hexLuminance("nope")).toBeNull()
  })

  it("layers an include the way VS Code does", () => {
    const parent = parseVsCodeThemeSource(
      '{"colors":{"a":"#111111","b":"#222222"},"tokenColors":[{"scope":"comment","settings":{"foreground":"#111111"}}]}'
    )
    const child = parseVsCodeThemeSource(
      '{"include":"./parent.json","colors":{"b":"#333333"},"tokenColors":[{"scope":"comment","settings":{"foreground":"#444444"}}]}'
    )
    const merged = mergeVsCodeThemeInclude(parent, child)
    expect(merged.include).toBeUndefined()
    expect(merged.colors).toEqual({ a: "#111111", b: "#333333" })
    expect(merged.tokenColors.map((r) => r.settings.foreground)).toEqual(["#111111", "#444444"])
  })

  it("derives ids and preview swatches", () => {
    expect(themeIdFromName("Dark Modern")).toBe("dark-modern")
    expect(themeIdFromName("  Ünïcode / Theme!! ")).toBe("unicode-theme")
    expect(themeIdFromName("---")).toBe("theme")
    const summary = summarizeImportedTheme({
      id: "x",
      name: "X",
      mode: "dark",
      source: { kind: "paste", label: "Pasted JSON" },
      colors: { "editor.background": "#101010", "focusBorder": "#ff0000" },
      tokenColors: [],
      semanticTokenColors: {},
      semanticHighlighting: false,
      importedAt: "2026-09-18T00:00:00.000Z",
    })
    expect(summary.preview).toEqual({ bg: "#101010", sidebar: "#101010", accent: "#ff0000" })
  })
})

describe("ThemeStore", () => {
  it("validates persisted metadata and normalizes damaged or older color tables", () => {
    const dataDir = tempDir("betterc0de-themes-")
    const store = new ThemeStore(dataDir)
    const original = store.importText({
      text: DARK_MODERN,
      source: { kind: "paste", label: "Pasted JSON" },
    })
    const file = path.join(dataDir, "themes", `${original.id}.json`)
    for (const damaged of [
      { ...original, source: null },
      { ...original, source: { kind: "unknown", label: "x" } },
      { ...original, mode: "unknown" },
      { ...original, importedAt: "not a date" },
      { ...original, id: "different-file" },
      { id: original.id, name: original.name },
    ]) {
      fs.writeFileSync(file, JSON.stringify(damaged))
      expect(store.get(original.id)).toBeNull()
      expect(store.list()).toEqual([])
    }
    fs.writeFileSync(file, JSON.stringify({
      ...original,
      colors: { "editor.background": 123, "editor.foreground": "#ffffff" },
      tokenColors: [null, { scope: 12, settings: false }],
      semanticTokenColors: false,
      semanticHighlighting: "false",
    }))
    expect(store.get(original.id)).toMatchObject({
      colors: { "editor.foreground": "#ffffff" },
      tokenColors: [],
      semanticTokenColors: {},
      semanticHighlighting: false,
    })
    const {
      colors: _colors,
      tokenColors: _tokenColors,
      semanticTokenColors: _semanticTokenColors,
      semanticHighlighting: _semanticHighlighting,
      ...older
    } = original
    fs.writeFileSync(file, JSON.stringify(older))
    expect(store.get(original.id)).toMatchObject({
      colors: {}, tokenColors: [], semanticTokenColors: {}, semanticHighlighting: false,
    })
  })

  it("imports text, lists, reads, keeps ids unique and deletes", () => {
    const dataDir = tempDir("betterc0de-themes-")
    const store = new ThemeStore(dataDir)
    const first = store.importText({
      text: DARK_MODERN,
      source: { kind: "file", label: "dark_modern.json" },
    })
    expect(first.id).toBe("dark-modern")
    expect(first.mode).toBe("dark")
    expect(first.source).toEqual({ kind: "file", label: "dark_modern.json" })
    const second = store.importText({
      text: DARK_MODERN,
      source: { kind: "paste", label: "Pasted JSON" },
    })
    expect(second.id).toBe("dark-modern-2")
    expect(store.list().map((t) => t.id)).toEqual(["dark-modern", "dark-modern-2"])
    expect(store.get("dark-modern")?.tokenColors).toHaveLength(3)
    expect(store.get("../etc/passwd")).toBeNull()
    expect(store.delete("dark-modern")).toBe(true)
    expect(store.delete("dark-modern")).toBe(false)
    expect(store.list().map((t) => t.id)).toEqual(["dark-modern-2"])
    expect(fs.readdirSync(path.join(dataDir, "themes")).some((f) => f.endsWith(".tmp"))).toBe(false)
  })

  it("refuses pasted text that needs an include, and resolves includes for installed files", () => {
    const store = new ThemeStore(tempDir("betterc0de-themes-"))
    expect(() =>
      store.importText({
        text: '{"include":"./base.json","colors":{"a":"#000000"}}',
        source: { kind: "paste", label: "Pasted JSON" },
      })
    ).toThrow(/includes "\.\/base\.json"/)

    const ext = tempDir("betterc0de-ext-")
    fs.mkdirSync(path.join(ext, "themes"))
    fs.writeFileSync(
      path.join(ext, "themes", "base.json"),
      '{"colors":{"editor.background":"#000000","x":"#010101"}}'
    )
    fs.writeFileSync(
      path.join(ext, "themes", "child.json"),
      '{"include":"./base.json","name":"Child","colors":{"x":"#020202"}}'
    )
    const merged = loadThemeWithIncludes(path.join(ext, "themes", "child.json"))
    expect(merged.colors).toEqual({ "editor.background": "#000000", x: "#020202" })
    expect(merged.include).toBeUndefined()
  })
})

describe("installed theme discovery", () => {
  it("reads contributes.themes from extension manifests and never leaves the extension folder", () => {
    const userDir = tempDir("betterc0de-vscode-ext-")
    const good = path.join(userDir, "publisher.nice-theme-1.0.0")
    fs.mkdirSync(path.join(good, "themes"), { recursive: true })
    fs.writeFileSync(
      path.join(good, "package.json"),
      `{
        // manifests are JSONC too
        "name": "nice-theme", "publisher": "publisher", "displayName": "Nice Theme",
        "contributes": { "themes": [
          null, false, 42, "not a theme", [],
          { "label": "Nice Dark", "uiTheme": "vs-dark", "path": "./themes/dark.json" },
          { "label": "Nice Light", "uiTheme": "vs", "path": "./themes/light.json" },
          { "label": "Escapee", "uiTheme": "vs", "path": "../../outside.json" },
          { "label": "Missing", "uiTheme": "vs", "path": "./themes/missing.json" }
        ] }
      }`
    )
    fs.writeFileSync(path.join(good, "themes", "dark.json"), "{}")
    fs.writeFileSync(path.join(good, "themes", "light.json"), "{}")
    fs.writeFileSync(path.join(userDir, "..", "outside.json"), "{}")
    cleanups.push(() => fs.rmSync(path.join(userDir, "..", "outside.json"), { force: true }))
    fs.mkdirSync(path.join(userDir, "no-themes"))
    fs.writeFileSync(path.join(userDir, "no-themes", "package.json"), '{"name":"x"}')
    fs.mkdirSync(path.join(userDir, "broken"))
    fs.writeFileSync(path.join(userDir, "broken", "package.json"), "{ not json")

    const found = discoverInstalledThemes({
      userExtensionDirs: [{ app: "cursor", dir: userDir }],
      builtinExtensionDirs: [{ app: "vscode", dir: path.join(userDir, "does-not-exist") }],
    })
    expect(found.map((t) => [t.app, t.label, t.uiTheme, t.extensionId, t.extensionName])).toEqual([
      ["cursor", "Nice Dark", "vs-dark", "publisher.nice-theme", "Nice Theme"],
      ["cursor", "Nice Light", "vs", "publisher.nice-theme", "Nice Theme"],
    ])
    expect(found[0]?.id).toBe("cursor:publisher.nice-theme:Nice Dark")
    expect(found[0]?.path).toBe(path.join(good, "themes", "dark.json"))
  })

  it("resolves %nls% labels and finds the per-build Windows install layout", () => {
    // Programs/Microsoft VS Code/<hash>/resources/app/extensions
    const appDir = tempDir("betterc0de-vscode-app-")
    const ext = path.join(appDir, "7debcd0e2a", "resources", "app", "extensions", "theme-defaults")
    fs.mkdirSync(path.join(ext, "themes"), { recursive: true })
    fs.writeFileSync(
      path.join(ext, "package.json"),
      `{
        "name": "theme-defaults", "publisher": "vscode", "displayName": "%displayName%",
        "contributes": { "themes": [
          { "label": "%darkModernThemeLabel%", "uiTheme": "vs-dark", "path": "./themes/dark_modern.json" },
          { "label": "%noSuchKey%", "uiTheme": "vs", "path": "./themes/light_vs.json" }
        ] }
      }`
    )
    fs.writeFileSync(
      path.join(ext, "package.nls.json"),
      '{"displayName":"Default Themes","darkModernThemeLabel":"Dark Modern"}'
    )
    fs.writeFileSync(path.join(ext, "themes", "dark_modern.json"), "{}")
    fs.writeFileSync(path.join(ext, "themes", "light_vs.json"), "{}")

    const found = discoverInstalledThemes({
      userExtensionDirs: [],
      builtinExtensionDirs: [
        { app: "vscode", dir: path.join(appDir, "resources", "app", "extensions") },
      ],
    })
    expect(found.map((t) => [t.label, t.extensionName])).toEqual([
      ["Dark Modern", "Default Themes"],
      // Unresolvable placeholder falls back to the file stem, never "%noSuchKey%".
      ["light_vs", "Default Themes"],
    ])
    expect(found[0]?.id).toBe("vscode:vscode.theme-defaults:Dark Modern")
  })

  it("knows where each platform keeps VS Code and Cursor", () => {
    const win = defaultThemeScanRoots("win32", { LOCALAPPDATA: "C:\\LAD", ProgramFiles: "C:\\PF" }, "C:\\Users\\me")
    expect(win.userExtensionDirs.map((r) => r.dir)).toContain(path.join("C:\\Users\\me", ".cursor", "extensions"))
    expect(win.builtinExtensionDirs.some((r) => r.app === "cursor" && r.dir.includes("cursor"))).toBe(true)
    expect(win.builtinExtensionDirs.some((r) => r.dir.startsWith("C:\\LAD"))).toBe(true)
    const mac = defaultThemeScanRoots("darwin", {}, "/Users/me")
    expect(mac.builtinExtensionDirs.map((r) => r.dir)).toContain(
      "/Applications/Cursor.app/Contents/Resources/app/extensions"
    )
    const linux = defaultThemeScanRoots("linux", {}, "/home/me")
    expect(linux.builtinExtensionDirs.some((r) => r.dir.startsWith("/usr/share/code"))).toBe(true)
  })
})
