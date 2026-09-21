import { afterEach, describe, expect, it, vi } from "vitest"
import { confirmCloseDirtyEditorTabs } from "@/lib/editor-close-confirmation"
import type { EditorTab } from "@/lib/editor-store"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("confirmCloseDirtyEditorTabs", () => {
  it("allows clean editors without prompting", () => {
    const confirm = vi.fn()
    vi.stubGlobal("confirm", confirm)

    expect(confirmCloseDirtyEditorTabs([tab({ isDirty: false })])).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it("prompts before closing dirty editors", () => {
    const confirm = vi.fn<(message?: string) => boolean>(() => true)
    vi.stubGlobal("confirm", confirm)

    expect(
      confirmCloseDirtyEditorTabs(
        [
          tab({ fileName: "dirty-a.ts", isDirty: true }),
          tab({ fileName: "clean-b.ts", isDirty: false }),
        ],
        "closing all editors"
      )
    ).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]?.[0]).toContain("dirty-a.ts")
    expect(confirm.mock.calls[0]?.[0]).not.toContain("clean-b.ts")
  })

  it("cancels the close when the user rejects the prompt", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false)
    )

    expect(confirmCloseDirtyEditorTabs([tab({ isDirty: true })])).toBe(false)
  })
})

function tab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: "tab-id",
    filePath: "/repo/src/file.ts",
    fileName: "file.ts",
    language: "typescript",
    content: "content",
    originalContent: "content",
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
