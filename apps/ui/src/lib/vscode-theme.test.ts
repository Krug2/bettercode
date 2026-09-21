import { describe, expect, it } from "vitest"
import type { ImportedTheme } from "@betterc0de/schema"
import {
  buildAppliedCustomTheme,
  customTemplateId,
  customThemeIdOf,
  isCustomTemplateId,
  themeToCssVars,
  themeToMonaco,
  themeToShiki,
} from "./vscode-theme"

function theme(overrides: Partial<ImportedTheme> = {}): ImportedTheme {
  return {
    id: "dark-modern",
    name: "Dark Modern",
    mode: "dark",
    source: { kind: "vscode", label: "vscode.theme-defaults" },
    colors: {
      "editor.background": "#1F1F1F",
      "editor.foreground": "#CCCCCC",
      "sideBar.background": "#181818",
      "button.background": "#0078D4",
      "button.foreground": "#FFFFFF",
      "focusBorder": "#0078D4",
      "panel.border": "#2B2B2B",
      "list.hoverBackground": "#2A2D2E",
      "descriptionForeground": "#9D9D9D",
      "errorForeground": "#F85149",
      "activityBarBadge.background": "#0078D4",
      "editorLineNumber.foreground": "#6E7681",
      "notARealMonacoColor.foo": "#123456",
    },
    tokenColors: [
      { scope: [], settings: { foreground: "#D4D4D4" } },
      { scope: ["comment"], settings: { foreground: "#6A9955" } },
      { scope: ["keyword.control", "storage.type"], settings: { foreground: "#C586C0" } },
      { scope: ["string"], settings: { foreground: "#CE9178" } },
      { scope: ["entity.name.type.class"], settings: { foreground: "#4EC9B0", fontStyle: "italic" } },
      { scope: ["comment"], settings: { foreground: "#7CA668" } },
      { scope: ["source.json meta.structure.dictionary.json support.type.property-name"], settings: { foreground: "#9CDCFE" } },
    ],
    semanticTokenColors: { newOperator: "#C586C0" },
    semanticHighlighting: true,
    importedAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  }
}

describe("custom template ids", () => {
  it("round-trips through the custom: prefix", () => {
    expect(customTemplateId("dark-modern")).toBe("custom:dark-modern")
    expect(isCustomTemplateId("custom:dark-modern")).toBe(true)
    expect(isCustomTemplateId("default-dark")).toBe(false)
    expect(customThemeIdOf("custom:dark-modern")).toBe("dark-modern")
    expect(customThemeIdOf("white")).toBeNull()
  })
})

describe("themeToCssVars", () => {
  it("maps the workbench colors a theme names and keeps borders translucent", () => {
    const vars = themeToCssVars(theme())
    expect(vars["--background"]).toBe("#1f1f1f")
    expect(vars["--foreground"]).toBe("#cccccc")
    expect(vars["--sidebar"]).toBe("#181818")
    expect(vars["--primary"]).toBe("#0078d4")
    expect(vars["--primary-foreground"]).toBe("#ffffff")
    expect(vars["--ring"]).toBe("#0078d4")
    expect(vars["--muted"]).toBe("#2a2d2e")
    expect(vars["--muted-foreground"]).toBe("#9d9d9d")
    expect(vars["--destructive"]).toBe("#f85149")
    expect(vars["--sidebar-primary"]).toBe("#0078d4")
    // panel.border with 60% alpha as 8-digit hex
    expect(vars["--border"]).toBe("#2b2b2b99")
    // The full token set the built-in templates set, so switching back and
    // forth never leaves a stale variable.
    expect(Object.keys(vars).sort()).toEqual(
      [
        "--accent", "--accent-foreground", "--background", "--border", "--card",
        "--card-foreground", "--destructive", "--foreground", "--input", "--muted",
        "--muted-foreground", "--popover", "--popover-foreground", "--primary",
        "--primary-foreground", "--ring", "--secondary", "--secondary-foreground",
        "--sidebar", "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border",
        "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
      ].sort()
    )
  })

  it("derives a complete workbench from an editor-only theme", () => {
    const dark = themeToCssVars({ mode: "dark", colors: { "editor.background": "#101010" } })
    expect(dark["--background"]).toBe("#101010")
    expect(dark["--sidebar"]).not.toBe("#101010")
    expect(dark["--card"]).toMatch(/^#[0-9a-f]{6}$/)
    expect(dark["--border"]).toMatch(/^#[0-9a-f]{8}$/)
    expect(dark["--primary-foreground"]).toBe("#111111") // light primary → dark text
    const light = themeToCssVars({ mode: "light", colors: {} })
    expect(light["--background"]).toBe("#ffffff")
    expect(light["--foreground"]).toBe("#1f1f1f")
    expect(light["--primary-foreground"]).toBe("#ffffff")
  })
})

describe("themeToMonaco", () => {
  it("folds TextMate scopes onto Monaco tokens, later rules winning", () => {
    const monaco = themeToMonaco(theme())
    expect(monaco.base).toBe("vs-dark")
    expect(monaco.inherit).toBe(true)
    const byToken = Object.fromEntries(monaco.rules.map((rule) => [rule.token, rule]))
    // The second `comment` rule replaced the first.
    expect(byToken.comment?.foreground).toBe("7ca668")
    expect(byToken.keyword?.foreground).toBe("c586c0")
    expect(byToken.string?.foreground).toBe("ce9178")
    expect(byToken.type).toMatchObject({ foreground: "4ec9b0", fontStyle: "italic" })
    expect(byToken["string.key.json"]?.foreground).toBe("9cdcfe")
    // No `#` in Monaco rule colors, and the scopeless default rule is not a token rule.
    expect(monaco.rules.every((rule) => !rule.foreground?.startsWith("#"))).toBe(true)
    expect(monaco.rules.some((rule) => rule.token === "")).toBe(false)
  })

  it("passes only the color ids the standalone editor knows", () => {
    const monaco = themeToMonaco(theme())
    expect(monaco.colors["editor.background"]).toBe("#1f1f1f")
    expect(monaco.colors["editorLineNumber.foreground"]).toBe("#6e7681")
    expect(monaco.colors["focusBorder"]).toBe("#0078d4")
    expect(monaco.colors).not.toHaveProperty("notARealMonacoColor.foo")
    expect(monaco.colors).not.toHaveProperty("sideBar.background")
    expect(monaco.colors).not.toHaveProperty("activityBarBadge.background")
  })

  it("takes the editor foreground from the default token rule when the workbench lacks it", () => {
    const monaco = themeToMonaco(
      theme({ colors: {}, tokenColors: [{ scope: [], settings: { foreground: "#ABCDEF", background: "#012345" } }] })
    )
    expect(monaco.colors["editor.foreground"]).toBe("#abcdef")
    expect(monaco.colors["editor.background"]).toBe("#012345")
    expect(themeToMonaco(theme({ mode: "light" })).base).toBe("vs")
  })
})

describe("themeToShiki / buildAppliedCustomTheme", () => {
  it("hands shiki the theme as-is under a namespaced name", () => {
    const shiki = themeToShiki(theme())
    expect(shiki.name).toBe("betterc0de-dark-modern")
    expect(shiki.type).toBe("dark")
    expect(shiki.tokenColors).toHaveLength(7)
    expect(shiki.colors["editor.background"]).toBe("#1F1F1F")
    const applied = buildAppliedCustomTheme(theme())
    expect(applied).toMatchObject({ id: "dark-modern", name: "Dark Modern", mode: "dark" })
    expect(applied.vars["--background"]).toBe("#1f1f1f")
    expect(applied.monaco.rules.length).toBeGreaterThan(0)
  })
})
