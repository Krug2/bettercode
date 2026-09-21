import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ImportedThemeSummary } from "@betterc0de/schema"
import { ImportedThemeList } from "./imported-themes-section"

vi.mock("@/components/dialogs/confirm-provider", () => ({
  useConfirm: () => async () => true,
}))

const summaries: ImportedThemeSummary[] = [
  {
    id: "dark-modern",
    name: "Dark Modern",
    mode: "dark",
    source: { kind: "vscode", label: "vscode.theme-defaults" },
    importedAt: "2026-09-18T00:00:00.000Z",
    preview: { bg: "#1f1f1f", sidebar: "#181818", accent: "#0078d4" },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    source: { kind: "paste", label: "Pasted JSON" },
    importedAt: "2026-09-18T00:00:00.000Z",
    preview: { bg: "#fdf6e3", sidebar: "#eee8d5", accent: "#268bd2" },
  },
]

describe("ImportedThemeList", () => {
  it("marks the active theme and names each one's origin", () => {
    const html = renderToStaticMarkup(
      <ImportedThemeList
        themes={summaries}
        activeTemplate="custom:dark-modern"
        busy={null}
        remote={false}
        onActivate={() => {}}
        onRemove={() => {}}
      />
    )
    expect(html).toContain('data-imported-theme="dark-modern"')
    expect(html).toMatch(/data-imported-theme="dark-modern"[^>]*data-active="true"/)
    expect(html).not.toMatch(/data-imported-theme="solarized-light"[^>]*data-active/)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain("VS Code · vscode.theme-defaults")
    expect(html).toContain("Pasted JSON")
    expect(html).toContain("background:#fdf6e3")
    expect(html).toContain('aria-label="Remove Dark Modern"')
  })

  it("hides removal for a paired browser, which cannot change the stored set", () => {
    const html = renderToStaticMarkup(
      <ImportedThemeList
        themes={summaries}
        activeTemplate="default-dark"
        busy={null}
        remote
        onActivate={() => {}}
        onRemove={() => {}}
      />
    )
    expect(html).not.toContain('aria-label="Remove ')
    expect(html).not.toContain("data-active")
    expect(html).toContain('aria-label="Use Dark Modern"')
  })
})
