import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EditorWorkspaceNavigation } from "./editor-workspace-navigation"

describe("editor workspace navigation", () => {
  it("labels the project and makes the current view visible to assistive technology", () => {
    const html = renderToStaticMarkup(
      <EditorWorkspaceNavigation
        projectPath="C:/work/project"
        projectName="Project"
        view="search"
        onViewChange={() => {}}
        onOpenFolder={() => {}}
      />
    )
    expect(html).toContain('aria-label="Workspace: Project. Switch workspace"')
    expect(html).toContain('aria-label="Editor views"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="More editor views"')
    expect(html).not.toContain("Activity Bar")
  })
  it.each([
    ["diff", "Diff"],
    ["map", "Code Map"],
  ] as const)(
    "offers %s directly and marks it as the selected view",
    (view, label) => {
      const html = renderToStaticMarkup(
        <EditorWorkspaceNavigation
          projectPath="C:/worktrees/project-feature"
          view={view}
          onViewChange={() => {}}
          onOpenFolder={() => {}}
        />
      )
      expect(html).toMatch(
        new RegExp(
          `<button[^>]*aria-current="page"[^>]*title="${label}"`
        )
      )
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    }
  )
})
