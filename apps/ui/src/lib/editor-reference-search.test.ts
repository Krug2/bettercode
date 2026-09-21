import { describe, expect, it } from "vitest"
import {
  buildOpenEditorReferenceSearch,
  findOpenEditorSymbolMatches,
  mergeReferenceResultsWithOpenEditors,
} from "@/lib/editor-reference-search"
import type { EditorTab } from "@/lib/editor-store"
import type { WorkspaceContentSearchResult } from "@/services/backend/workspaceApi"

function tab(
  input: Partial<EditorTab> & { filePath: string; content: string }
) {
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
  } satisfies EditorTab
}

describe("editor reference search", () => {
  it("finds whole-word symbol matches in open editor content", () => {
    expect(
      findOpenEditorSymbolMatches(
        [
          "const UserCard = createUserCard()",
          "const userCardVariant = UserCard",
          "const NotUserCard = null",
        ].join("\n"),
        "UserCard"
      ).map((match) => ({
        line: match.line,
        column: match.column,
        previewColumn: match.previewColumn,
      }))
    ).toEqual([
      { line: 1, column: 7, previewColumn: 7 },
      { line: 2, column: 25, previewColumn: 25 },
    ])
  })

  it("builds reference results from unsaved open tabs", () => {
    const results = buildOpenEditorReferenceSearch({
      projectPath: "/repo/app",
      symbol: "loadUser",
      tabs: [
        tab({
          filePath: "/repo/app/src/users.ts",
          content: "export function loadUser() {}\nloadUser()",
          isDirty: true,
        }),
      ],
    })

    expect(results.results).toEqual([
      {
        path: "src/users.ts",
        name: "users.ts",
        matches: [
          expect.objectContaining({ line: 1, column: 17, length: 8 }),
          expect.objectContaining({ line: 2, column: 1, length: 8 }),
        ],
      },
    ])
    expect(results.searchedPathKeys.has("src/users.ts")).toBe(true)
  })

  it("overlays open editor results over stale disk results", () => {
    const diskResults: WorkspaceContentSearchResult[] = [
      {
        path: "src/users.ts",
        name: "users.ts",
        matches: [
          {
            line: 10,
            column: 1,
            length: 8,
            previewColumn: 1,
            previewLength: 8,
            preview: "loadUser",
          },
        ],
      },
      {
        path: "src/profile.ts",
        name: "profile.ts",
        matches: [
          {
            line: 3,
            column: 5,
            length: 8,
            previewColumn: 5,
            previewLength: 8,
            preview: "use loadUser",
          },
        ],
      },
    ]
    const openEditors = buildOpenEditorReferenceSearch({
      projectPath: "/repo/app",
      symbol: "loadUser",
      tabs: [
        tab({
          filePath: "/repo/app/src/users.ts",
          content: "const removed = true",
          isDirty: true,
        }),
        tab({
          filePath: "/repo/app/src/new.ts",
          content: "loadUser()",
          isDirty: true,
        }),
      ],
    })

    expect(
      mergeReferenceResultsWithOpenEditors({ diskResults, openEditors }).map(
        (result) => result.path
      )
    ).toEqual(["src/new.ts", "src/profile.ts"])
  })
})
