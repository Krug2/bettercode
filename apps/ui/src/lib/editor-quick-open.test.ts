import { describe, expect, it } from "vitest"
import {
  buildEditorQuickOpenItems,
  parseEditorQuickOpenQuery,
  type EditorQuickOpenItemSource,
} from "@/lib/editor-quick-open"
import type { EditorRecentFile, EditorTab } from "@/lib/editor-store"

function tab(input: Partial<EditorTab> & { filePath: string }): EditorTab {
  const fileName = input.filePath.split(/[/\\]/).pop() ?? input.filePath
  return {
    id: input.id ?? input.filePath,
    filePath: input.filePath,
    fileName: input.fileName ?? fileName,
    language: "typescript",
    content: "",
    originalContent: "",
    revision: 0,
    readGeneration: 0,
    documentVersion: 0,
    aiBaselineContent: null,
    isDirty: input.isDirty ?? false,
    isLoading: false,
    isPinned: input.isPinned ?? false,
    isPreview: input.isPreview ?? false,
    cursorLine: input.cursorLine ?? 1,
    cursorColumn: input.cursorColumn ?? 1,
    selectionLineCount: 0,
    selectionCharCount: 0,
  }
}

function recent(input: Partial<EditorRecentFile> & { filePath: string }) {
  const fileName = input.filePath.split(/[/\\]/).pop() ?? input.filePath
  return {
    filePath: input.filePath,
    fileName: input.fileName ?? fileName,
    language: input.language ?? "typescript",
    line: input.line ?? 1,
    column: input.column ?? 1,
  } satisfies EditorRecentFile
}

describe("buildEditorQuickOpenItems", () => {
  it("parses path:line and path:line:column quick-open queries", () => {
    expect(parseEditorQuickOpenQuery("src/app.tsx:42")).toEqual({
      searchQuery: "src/app.tsx",
      line: 42,
      column: 1,
    })
    expect(parseEditorQuickOpenQuery("src/app.tsx:42:7")).toEqual({
      searchQuery: "src/app.tsx",
      line: 42,
      column: 7,
    })
    expect(parseEditorQuickOpenQuery("src/app.tsx:0")).toEqual({
      searchQuery: "src/app.tsx:0",
    })
    expect(parseEditorQuickOpenQuery("src/app.tsx:10:0")).toEqual({
      searchQuery: "src/app.tsx:10:0",
    })
  })

  it("puts the active editor and open tabs before workspace files", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "",
      tabs: [
        tab({ id: "a", filePath: "/repo/app/src/a.ts" }),
        tab({ id: "b", filePath: "/repo/app/src/b.ts", isPinned: true }),
      ],
      activeTabId: "b",
      recentlyClosedTabs: [],
      workspaceFiles: [
        { path: "src/a.ts", name: "a.ts" },
        { path: "src/c.ts", name: "c.ts" },
      ],
    })

    expect(items.map((item) => item.relativePath)).toEqual([
      "src/b.ts",
      "src/a.ts",
      "src/c.ts",
    ])
    expect(items.map((item) => item.source)).toEqual([
      "active",
      "open",
      "workspace",
    ] satisfies EditorQuickOpenItemSource[])
  })

  it("deduplicates workspace files already represented by an open tab", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "a",
      tabs: [tab({ filePath: "/repo/app/src/a.ts" })],
      activeTabId: null,
      recentlyClosedTabs: [],
      workspaceFiles: [{ path: "src/a.ts", name: "a.ts" }],
    })

    expect(items).toHaveLength(1)
    expect(items[0]?.source).toBe("open")
  })

  it("includes recently closed tabs when they match the query", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "closed",
      tabs: [],
      activeTabId: null,
      recentlyClosedTabs: [tab({ filePath: "/repo/app/src/closed.ts" })],
      workspaceFiles: [],
    })

    expect(items).toEqual([
      expect.objectContaining({
        relativePath: "src/closed.ts",
        source: "recent",
      }),
    ])
  })

  it("includes editor history before workspace-only matches", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "preview",
      tabs: [],
      activeTabId: null,
      recentlyClosedTabs: [],
      recentFiles: [
        recent({ filePath: "/repo/app/src/preview.ts", line: 33, column: 7 }),
      ],
      workspaceFiles: [{ path: "src/preview.ts", name: "preview.ts" }],
    })

    expect(items).toEqual([
      expect.objectContaining({
        relativePath: "src/preview.ts",
        source: "history",
        line: 33,
        column: 7,
      }),
    ])
  })

  it("deduplicates editor history behind open tabs", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "shared",
      tabs: [tab({ filePath: "/repo/app/src/shared.ts" })],
      activeTabId: null,
      recentlyClosedTabs: [],
      recentFiles: [recent({ filePath: "/repo/app/src/shared.ts" })],
      workspaceFiles: [{ path: "src/shared.ts", name: "shared.ts" }],
    })

    expect(items).toHaveLength(1)
    expect(items[0]?.source).toBe("open")
  })

  it("supports fuzzy path matching", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "srcbt",
      tabs: [],
      activeTabId: null,
      recentlyClosedTabs: [],
      workspaceFiles: [
        { path: "src/components/button.tsx", name: "button.tsx" },
      ],
    })

    expect(items[0]?.relativePath).toBe("src/components/button.tsx")
  })

  it("applies path suffix line and column to workspace matches", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "src/app.ts:33:4",
      tabs: [],
      activeTabId: null,
      recentlyClosedTabs: [],
      workspaceFiles: [{ path: "src/app.ts", name: "app.ts" }],
    })

    expect(items).toEqual([
      expect.objectContaining({
        relativePath: "src/app.ts",
        source: "workspace",
        line: 33,
        column: 4,
      }),
    ])
  })

  it("uses path suffix line and column over an open tab cursor", () => {
    const items = buildEditorQuickOpenItems({
      projectPath: "/repo/app",
      query: "src/open.ts:25:6",
      tabs: [
        tab({
          filePath: "/repo/app/src/open.ts",
          cursorLine: 4,
          cursorColumn: 2,
        }),
      ],
      activeTabId: null,
      recentlyClosedTabs: [],
      workspaceFiles: [],
    })

    expect(items[0]).toEqual(
      expect.objectContaining({
        relativePath: "src/open.ts",
        source: "open",
        line: 25,
        column: 6,
      })
    )
  })
})
