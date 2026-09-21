import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  isReferenceSearchableSymbol,
  useEditorReferencesStore,
} from "@/lib/editor-references-store"

beforeEach(() => {
  useEditorReferencesStore.getState().clearReferenceRequest()
})

describe("editor references store", () => {
  it("normalizes requests and timestamps them", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00Z"))
    useEditorReferencesStore.getState().setReferenceRequest({
      symbol: "  UserCard ",
      originFilePath: "\\repo\\src\\UserCard.tsx",
      originLine: 12,
      originColumn: 4,
    })

    expect(useEditorReferencesStore.getState().request).toEqual({
      symbol: "UserCard",
      originFilePath: "/repo/src/UserCard.tsx",
      originLine: 12,
      originColumn: 4,
      requestedAt: Date.parse("2026-05-14T10:00:00Z"),
    })
    vi.useRealTimers()
  })

  it("validates symbols suitable for project search", () => {
    expect(isReferenceSearchableSymbol("loadUser")).toBe(true)
    expect(isReferenceSearchableSymbol("_private")).toBe(true)
    expect(isReferenceSearchableSymbol("$store")).toBe(true)
    expect(isReferenceSearchableSymbol("2bad")).toBe(false)
    expect(isReferenceSearchableSymbol("two words")).toBe(false)
    expect(isReferenceSearchableSymbol("")).toBe(false)
  })
})
