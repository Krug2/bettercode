import { describe, expect, it } from "vitest"
import {
  buildOpenEditorContentSearch,
  findOpenEditorContentMatches,
  mergeContentSearchResultsWithOpenEditors,
} from "@/lib/editor-content-search"
import type { EditorTab } from "@/lib/editor-store"
import type { WorkspaceContentSearchResult } from "@/services/backend/workspaceApi"

describe("editor content search", () => {
  it("finds literal whole-word matches in open editor content", () => {
    expect(
      findOpenEditorContentMatches("Foo foo foobar\n\tfoo", "foo", {
        caseSensitive: false,
        wholeWord: true,
      }).map((match) => ({
        line: match.line,
        column: match.column,
        length: match.length,
        previewColumn: match.previewColumn,
      }))
    ).toEqual([
      { line: 1, column: 1, length: 3, previewColumn: 1 },
      { line: 1, column: 5, length: 3, previewColumn: 5 },
      { line: 2, column: 2, length: 3, previewColumn: 1 },
    ])
  })

  it("finds regex matches and reports invalid regex input", () => {
    expect(
      findOpenEditorContentMatches(
        "loadUser()\nloadTeam()\nloadThing()",
        "load(User|Team)",
        { regex: true }
      ).map((match) => ({ line: match.line, column: match.column }))
    ).toEqual([
      { line: 1, column: 1 },
      { line: 2, column: 1 },
    ])

    expect(() =>
      findOpenEditorContentMatches("needle", "[", { regex: true })
    ).toThrow("Invalid search regex")
  })

  it("builds search results from unsaved open tabs with include/exclude filters", () => {
    const results = buildOpenEditorContentSearch({
      projectPath: "/repo",
      query: "needle",
      options: { include: "src/**", exclude: "**/*.test.ts" },
      tabs: [
        tab({
          filePath: "/repo/src/a.ts",
          content: "const value = 'needle'",
          isDirty: true,
        }),
        tab({
          filePath: "/repo/src/a.test.ts",
          content: "needle",
          isDirty: true,
        }),
        tab({
          filePath: "/repo/docs/readme.md",
          content: "needle",
          isDirty: true,
        }),
      ],
    })

    expect(results.results).toEqual([
      {
        path: "src/a.ts",
        name: "a.ts",
        matches: [expect.objectContaining({ line: 1, column: 16, length: 6 })],
      },
    ])
    expect([...results.searchedPathKeys]).toEqual(["src/a.ts"])
  })

  it("honors the workspace search limit for open editor matches", () => {
    const results = buildOpenEditorContentSearch({
      projectPath: "/repo",
      query: "needle",
      options: { limit: 1 },
      tabs: [
        tab({ filePath: "/repo/src/a.ts", content: "needle needle" }),
        tab({ filePath: "/repo/src/b.ts", content: "needle" }),
      ],
    })

    expect(results.results).toEqual([
      {
        path: "src/a.ts",
        name: "a.ts",
        matches: [expect.objectContaining({ line: 1, column: 1 })],
      },
    ])
  })

  it("overlays open editor content over stale disk search results", () => {
    const diskResults: WorkspaceContentSearchResult[] = [
      searchResult("src/a.ts", "a.ts"),
      searchResult("src/b.ts", "b.ts"),
    ]
    const openEditors = buildOpenEditorContentSearch({
      projectPath: "/repo",
      query: "needle",
      tabs: [
        tab({
          filePath: "/repo/src/a.ts",
          content: "const removed = true",
          isDirty: true,
        }),
        tab({
          filePath: "/repo/src/c.ts",
          content: "needle",
          isDirty: true,
        }),
      ],
    })

    expect(
      mergeContentSearchResultsWithOpenEditors({
        diskResults,
        openEditors,
      }).map((result) => result.path)
    ).toEqual(["src/c.ts", "src/b.ts"])
  })
})

function searchResult(
  path: string,
  name: string
): WorkspaceContentSearchResult {
  return {
    path,
    name,
    matches: [
      {
        line: 1,
        column: 1,
        length: 6,
        previewColumn: 1,
        previewLength: 6,
        preview: "needle",
      },
    ],
  }
}

function tab(
  input: Partial<EditorTab> & { filePath: string; content: string }
): EditorTab {
  const fileName = input.filePath.split(/[/\\]/).pop() ?? input.filePath
  return {
    id: input.id ?? input.filePath,
    filePath: input.filePath,
    fileName: input.fileName ?? fileName,
    language: input.language ?? "typescript",
    content: input.content,
    originalContent: input.originalContent ?? input.content,
    revision: 0,
    readGeneration: 0,
    documentVersion: 0,
    aiBaselineContent: input.aiBaselineContent ?? null,
    isDirty: input.isDirty ?? false,
    isLoading: false,
    isPinned: input.isPinned ?? false,
    isPreview: input.isPreview ?? false,
    cursorLine: input.cursorLine ?? 1,
    cursorColumn: input.cursorColumn ?? 1,
    selectionLineCount: input.selectionLineCount ?? 0,
    selectionCharCount: input.selectionCharCount ?? 0,
  }
}
