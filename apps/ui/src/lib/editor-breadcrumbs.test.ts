import { describe, expect, it } from "vitest"
import {
  buildEditorBreadcrumbSegments,
  shouldShowEditorBreadcrumbs,
} from "@/lib/editor-breadcrumbs"

describe("buildEditorBreadcrumbSegments", () => {
  it("builds revealable folder and file segments for workspace files", () => {
    expect(
      buildEditorBreadcrumbSegments(
        "/repo/app",
        "/repo/app/src/components/editor.tsx"
      )
    ).toEqual([
      {
        label: "src",
        kind: "folder",
        relativePath: "src",
        absolutePath: "/repo/app/src",
        revealable: true,
      },
      {
        label: "components",
        kind: "folder",
        relativePath: "src/components",
        absolutePath: "/repo/app/src/components",
        revealable: true,
      },
      {
        label: "editor.tsx",
        kind: "file",
        relativePath: "src/components/editor.tsx",
        absolutePath: "/repo/app/src/components/editor.tsx",
        revealable: true,
      },
    ])
  })

  it("keeps outside-workspace paths visible but not revealable", () => {
    const segments = buildEditorBreadcrumbSegments(
      "/repo/app",
      "/tmp/outside.ts"
    )

    expect(segments.at(-1)).toEqual({
      label: "outside.ts",
      kind: "file",
      relativePath: "tmp/outside.ts",
      absolutePath: "/tmp/outside.ts",
      revealable: false,
    })
    expect(segments.every((segment) => segment.revealable === false)).toBe(true)
  })
})

describe("shouldShowEditorBreadcrumbs", () => {
  it("hides a root file breadcrumb that only duplicates the active tab", () => {
    expect(shouldShowEditorBreadcrumbs(1, 0)).toBe(false)
  })

  it("shows breadcrumbs for nested paths or an active outline symbol", () => {
    expect(shouldShowEditorBreadcrumbs(2, 0)).toBe(true)
    expect(shouldShowEditorBreadcrumbs(1, 1)).toBe(true)
  })
})
