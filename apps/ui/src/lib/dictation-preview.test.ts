import { describe, expect, it } from "vitest"
import { readDictationPreview, updateDictationDraft } from "./dictation-preview"

describe("dictation drafts", () => {
  it("replaces revised interim words and commits the corrected final result", () => {
    const first = updateDictationDraft("Please", null, "write a", false)
    const revised = updateDictationDraft(first.value, first, "write the test", false)
    expect(revised).toEqual({ value: "Please write the test", interimStart: 6 })
    const final = updateDictationDraft(revised.value, revised, "write the tests.", true)
    expect(final).toEqual({ value: "Please write the tests.", interimStart: null })
    expect(updateDictationDraft(final.value, final, "Then run", false)).toEqual({
      value: "Please write the tests. Then run", interimStart: final.value.length,
    })
  })

  it("keeps multiline Unicode input and uses UTF-16 offsets", () => {
    const draft = updateDictationDraft("🎙️\n", null, "Hallo", false)
    expect(draft).toEqual({ value: "🎙️\nHallo", interimStart: "🎙️\n".length })
    expect(updateDictationDraft(draft.value, draft, "Hallo Welt!", true).value).toBe("🎙️\nHallo Welt!")
  })

  it("clears a withdrawn hypothesis without leaving a separator", () => {
    const draft = updateDictationDraft("Prefix", null, "noise", false)
    expect(updateDictationDraft(draft.value, draft, "", true)).toEqual({ value: "Prefix", interimStart: null })
    expect(updateDictationDraft("", null, "", false)).toEqual({ value: "", interimStart: null })
  })

  it("never removes user changes when a previous snapshot no longer matches", () => {
    const draft = updateDictationDraft("", null, "Hello", false)
    expect(updateDictationDraft("My edit", draft, "world", true).value).toBe("My edit world")
  })

  it.each([-1, 5, 0.5, NaN, "1", undefined])("rejects an invalid preview offset: %s", (interimStart) => {
    expect(readDictationPreview(new CustomEvent("preview", { detail: { value: "text", interimStart } }))).toBeNull()
  })

  it("validates preview events before exposing their contents", () => {
    expect(readDictationPreview(new Event("preview"))).toBeNull()
    expect(readDictationPreview(new CustomEvent("preview", { detail: { value: 42, interimStart: 0 } }))).toBeNull()
    expect(readDictationPreview(new CustomEvent("preview", { detail: { value: "text", interimStart: 0 } })))
      .toEqual({ value: "text", interimStart: 0 })
  })
})
