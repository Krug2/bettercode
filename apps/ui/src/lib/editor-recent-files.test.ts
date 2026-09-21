import { describe, expect, it } from "vitest"
import { buildEditorRecentFileItems } from "@/lib/editor-recent-files"
import type { EditorRecentFile, EditorTab } from "@/lib/editor-store"

describe("buildEditorRecentFileItems", () => {
  it("shows recent workspace files that are not already open", () => {
    const items = buildEditorRecentFileItems({
      projectPath: "/repo/app",
      tabs: [tab("/repo/app/src/open.ts")],
      recentFiles: [
        recent("/repo/app/src/open.ts"),
        recent("/repo/app/src/closed.ts", { line: 12, column: 4 }),
      ],
    })

    expect(items).toEqual([
      {
        filePath: "/repo/app/src/closed.ts",
        relativePath: "src/closed.ts",
        fileName: "closed.ts",
        language: "typescript",
        line: 12,
        column: 4,
      },
    ])
  })

  it("deduplicates recent files and skips outside-workspace paths", () => {
    const items = buildEditorRecentFileItems({
      projectPath: "/repo/app",
      tabs: [],
      recentFiles: [
        recent("/tmp/outside.ts"),
        recent("/repo/app/src/a.ts"),
        recent("/repo/app/src/a.ts", { line: 99 }),
        recent("/repo/app/src/b.ts"),
      ],
    })

    expect(items.map((item) => item.relativePath)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ])
    expect(items[0]?.line).toBe(1)
  })

  it("honors the requested limit and clamps locations", () => {
    const items = buildEditorRecentFileItems({
      projectPath: "/repo/app",
      tabs: [],
      limit: 1,
      recentFiles: [
        recent("/repo/app/src/a.ts", { line: 0, column: -2 }),
        recent("/repo/app/src/b.ts"),
      ],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      relativePath: "src/a.ts",
      line: 1,
      column: 1,
    })
  })
})

function recent(
  filePath: string,
  overrides: Partial<EditorRecentFile> = {}
): EditorRecentFile {
  return {
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    language: "typescript",
    line: 1,
    column: 1,
    ...overrides,
  }
}

function tab(filePath: string, overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: filePath,
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    language: "typescript",
    content: "",
    originalContent: "",
    revision: 0,
    readGeneration: 0,
    documentVersion: 0,
    aiBaselineContent: null,
    isDirty: false,
    isLoading: false,
    isPinned: false,
    isPreview: false,
    cursorLine: 1,
    cursorColumn: 1,
    selectionLineCount: 0,
    selectionCharCount: 0,
    ...overrides,
  }
}
