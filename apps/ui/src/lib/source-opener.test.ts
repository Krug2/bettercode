import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  dispatchGotoLine: vi.fn(),
  openExternal: vi.fn(),
  openFile: vi.fn(),
  setPreference: vi.fn(),
  thread: {
    id: "thread-1",
    projectPath: "C:/repo",
    worktreePath: null as string | null,
  },
  tabs: [] as Array<{
    filePath: string
    fileName: string
    language: string
    content: string
  }>,
}))

vi.mock("@/lib/chat-store", () => ({
  useChatStore: {
    getState: () => ({
      activeThreadId: "thread-1",
      threads: [mocks.thread],
    }),
  },
}))

vi.mock("@/lib/editor-go-to-line", () => ({
  dispatchEditorGotoLine: mocks.dispatchGotoLine,
}))

vi.mock("@/lib/editor-store", () => ({
  useEditorStore: {
    getState: () => ({ openFile: mocks.openFile, tabs: mocks.tabs }),
  },
}))

vi.mock("@/lib/preferences-store", () => ({
  usePreferencesStore: {
    getState: () => ({ set: mocks.setPreference }),
  },
}))

import { openSourceReference, openSourceTarget } from "@/lib/source-opener"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.openFile.mockResolvedValue(undefined)
  mocks.openExternal.mockResolvedValue(undefined)
  mocks.tabs.length = 0
  mocks.thread.worktreePath = null
  vi.stubGlobal("window", {
    electronAPI: { openExternal: mocks.openExternal },
  })
})

describe("openSourceTarget", () => {
  it("opens a workspace file and reveals its full range", async () => {
    await expect(
      openSourceTarget({
        kind: "file",
        filePath: "src/app.ts",
        line: 12,
        column: 4,
        endLine: 18,
        endColumn: 9,
      })
    ).resolves.toBe(true)

    expect(mocks.setPreference).toHaveBeenCalledWith("appMode", "editor")
    expect(mocks.openFile).toHaveBeenCalledWith("C:/repo/src/app.ts", {
      line: 12,
      column: 4,
      preserveNavigation: undefined,
      preview: undefined,
    })
    expect(mocks.dispatchGotoLine).toHaveBeenCalledWith(
      {
        filePath: "C:/repo/src/app.ts",
        line: 12,
        column: 4,
        endLine: 18,
        endColumn: 9,
        preserveNavigation: true,
      },
      { defer: true }
    )
  })

  it("prefers the active thread worktree for relative references", async () => {
    mocks.thread.worktreePath = "C:/repo-worktree"

    await expect(
      openSourceTarget({ kind: "file", filePath: "src/app.ts" })
    ).resolves.toBe(true)

    expect(mocks.openFile).toHaveBeenCalledWith(
      "C:/repo-worktree/src/app.ts",
      expect.any(Object)
    )
  })

  it("opens safe external targets without touching editor state", async () => {
    await expect(
      openSourceTarget({
        kind: "external",
        url: "https://example.test/docs",
      })
    ).resolves.toBe(true)

    expect(mocks.openExternal).toHaveBeenCalledWith("https://example.test/docs")
    expect(mocks.openFile).not.toHaveBeenCalled()
    expect(mocks.setPreference).not.toHaveBeenCalled()
  })

  it("resolves a symbol from the loaded editor when no line is supplied", async () => {
    mocks.tabs.push({
      filePath: "C:/repo/src/app.ts",
      fileName: "app.ts",
      language: "typescript",
      content: "const before = 1\nexport function renderApp() {}\n",
    })

    await expect(
      openSourceTarget({
        kind: "symbol",
        filePath: "src/app.ts",
        symbol: "renderApp",
      })
    ).resolves.toBe(true)

    expect(mocks.dispatchGotoLine).toHaveBeenCalledWith(
      {
        filePath: "C:/repo/src/app.ts",
        line: 2,
        column: 1,
        endLine: undefined,
        endColumn: undefined,
        preserveNavigation: true,
      },
      { defer: true }
    )
  })

  it("rejects unsafe references without side effects", async () => {
    await expect(openSourceReference("javascript:alert(1)")).resolves.toBe(
      false
    )
    await expect(
      openSourceReference("../outside.ts", { workspacePath: "C:/repo" })
    ).resolves.toBe(false)

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.openFile).not.toHaveBeenCalled()
  })
})
