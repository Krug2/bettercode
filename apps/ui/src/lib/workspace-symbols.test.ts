import { describe, expect, it } from "vitest"
import {
  buildOpenEditorWorkspaceSymbolSources,
  buildOpenEditorWorkspaceSymbolSourcesFromTabs,
  buildWorkspaceDefinitionCandidates,
  buildWorkspaceSymbols,
} from "@/lib/workspace-symbols"
import type { EditorTab } from "@/lib/editor-store"

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

describe("buildWorkspaceSymbols", () => {
  it("ranks direct symbol-name matches ahead of path-only matches", () => {
    const symbols = buildWorkspaceSymbols(
      [
        {
          filePath: "/repo/src/components/UserCard.tsx",
          relativePath: "src/components/UserCard.tsx",
          content: [
            "export function loadUser() {",
            "  return null",
            "}",
            "export const UserCard = () => null",
          ].join("\n"),
        },
        {
          filePath: "/repo/src/user/routes.ts",
          relativePath: "src/user/routes.ts",
          content: "export function route() { return null }",
        },
      ],
      "UserCard"
    )

    expect(symbols.map((symbol) => symbol.name).slice(0, 2)).toEqual([
      "UserCard",
      "loadUser",
    ])
    expect(symbols[0]).toMatchObject({
      relativePath: "src/components/UserCard.tsx",
      line: 4,
    })
  })

  it("extracts symbols across languages", () => {
    const symbols = buildWorkspaceSymbols(
      [
        {
          filePath: "/repo/server/app.py",
          relativePath: "server/app.py",
          content: "class Runner:\n    def start(self):\n        pass\n",
        },
        {
          filePath: "/repo/src/lib.rs",
          relativePath: "src/lib.rs",
          content: "pub fn start_server() {}\n",
        },
      ],
      "start"
    )

    expect(symbols.map((symbol) => [symbol.name, symbol.relativePath])).toEqual(
      [
        ["start", "server/app.py"],
        ["start_server", "src/lib.rs"],
      ]
    )
  })

  it("finds exact definition candidates without fuzzy path matches", () => {
    const definitions = buildWorkspaceDefinitionCandidates(
      [
        {
          filePath: "/repo/src/components/UserCard.tsx",
          relativePath: "src/components/UserCard.tsx",
          content: "export const UserCard = () => null",
        },
        {
          filePath: "/repo/src/user/routes.ts",
          relativePath: "src/user/routes.ts",
          content: "export function route() { return null }",
        },
      ],
      {
        symbol: "UserCard",
        originFilePath: "/repo/src/pages/index.tsx",
        originLine: 12,
        originColumn: 8,
      }
    )

    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toMatchObject({
      name: "UserCard",
      relativePath: "src/components/UserCard.tsx",
      line: 1,
    })
  })

  it("prefers same-file nearby definitions", () => {
    const definitions = buildWorkspaceDefinitionCandidates(
      [
        {
          filePath: "/repo/src/page.tsx",
          relativePath: "src/page.tsx",
          content: [
            "export function renderPage() {",
            "  return loadUser()",
            "}",
            "",
            "function loadUser() {",
            "  return null",
            "}",
          ].join("\n"),
        },
        {
          filePath: "/repo/src/lib/loadUser.ts",
          relativePath: "src/lib/loadUser.ts",
          content: "export function loadUser() { return null }",
        },
      ],
      {
        symbol: "loadUser",
        originFilePath: "/repo/src/page.tsx",
        originLine: 2,
        originColumn: 10,
      }
    )

    expect(definitions[0]).toMatchObject({
      relativePath: "src/page.tsx",
      line: 5,
    })
  })

  it("builds definition sources from current content and open editor overlays", () => {
    const result = buildOpenEditorWorkspaceSymbolSources({
      projectPath: "/repo/app",
      currentFilePath: "/repo/app/src/page.tsx",
      currentContent: "renderPage()",
      tabs: [
        tab({
          filePath: "/repo/app/src/page.tsx",
          content: "stale open duplicate",
        }),
        tab({
          filePath: "/repo/app/src/draft.ts",
          content: "export function DraftPanel() {}",
          isDirty: true,
        }),
      ],
    })

    expect(result.sources.map((source) => source.relativePath)).toEqual([
      "src/page.tsx",
      "src/draft.ts",
    ])
    expect(result.sources[0]?.content).toBe("renderPage()")
    expect(result.sourcePathKeys.has("src/page.tsx")).toBe(true)
    expect(result.sourcePathKeys.has("src/draft.ts")).toBe(true)
  })

  it("builds workspace symbol sources from open tabs without duplicate paths", () => {
    const result = buildOpenEditorWorkspaceSymbolSourcesFromTabs({
      projectPath: "/repo/app",
      tabs: [
        tab({
          id: "draft-a",
          filePath: "/repo/app/src/draft.ts",
          content: "export function DraftPanel() {}",
        }),
        tab({
          id: "draft-b",
          filePath: "/repo/app/src/draft.ts",
          content: "stale duplicate",
        }),
        tab({
          filePath: "/repo/app/src/new-symbol.ts",
          content: "export class NewSymbol {}",
        }),
      ],
    })

    expect(result.sources.map((source) => source.relativePath)).toEqual([
      "src/draft.ts",
      "src/new-symbol.ts",
    ])
    expect(buildWorkspaceSymbols(result.sources, "NewSymbol")).toEqual([
      expect.objectContaining({
        name: "NewSymbol",
        relativePath: "src/new-symbol.ts",
      }),
    ])
    expect(result.sourcePathKeys.has("src/draft.ts")).toBe(true)
    expect(result.sourcePathKeys.has("src/new-symbol.ts")).toBe(true)
  })
})
