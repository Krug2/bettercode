import { describe, expect, it } from "vitest"
import { assignBrowserMentionNames, browserMentionRanges, maskBrowserMentions, removeBrowserMentionAtCursor, removedBrowserMentions } from "./browser-element-mentions"

const heading = { url: "https://example.com/", selector: "h1", tagName: "h1", label: "Title", text: "Title", mentionName: "H1" }

describe("inline browser mentions", () => {
  it("assigns unique names without colliding with an existing file mention", () => {
    const raw = { ...heading, mentionName: undefined }
    expect(assignBrowserMentionNames([raw, { ...raw, selector: "h1.second" }], "Open @H1").map(element => element.mentionName)).toEqual(["H12", "H13"])
  })
  it("keeps existing names when adding a second element", () => {
    expect(assignBrowserMentionNames([heading, { ...heading, mentionName: undefined, selector: "h1.second" }], "@H1").map(element => element.mentionName)).toEqual(["H1", "H12"])
  })
  it("removes the entire mention with Backspace or Delete, including from its middle", () => {
    expect(removeBrowserMentionAtCursor("Fix @H1 now", 7, 7, "Backspace", [heading])).toEqual({ value: "Fix  now", cursor: 4 })
    expect(removeBrowserMentionAtCursor("Fix @H1 now", 5, 5, "Delete", [heading])).toEqual({ value: "Fix  now", cursor: 4 })
    expect(removeBrowserMentionAtCursor("Fix @H1 now", 4, 4, "Backspace", [heading])).toBeNull()
    expect(removeBrowserMentionAtCursor("Fix @H1 now", 7, 7, "Delete", [heading])).toBeNull()
  })
  it("expands a partial selection to the full mention", () => {
    expect(removeBrowserMentionAtCursor("Fix @H1 now", 2, 6, "Backspace", [heading])).toEqual({ value: "Fi now", cursor: 2 })
  })
  it("only detaches metadata when the final occurrence is removed", () => {
    expect(removedBrowserMentions("@H1 and @H1", "@H1", [heading])).toEqual([])
    expect(removedBrowserMentions("@H1", "", [heading])).toEqual([heading])
  })
  it("masks component tokens while leaving file paths and emails untouched", () => {
    expect(maskBrowserMentions("@H1 @src/app.ts a@H1 @H1/file", [heading])).toBe("    @src/app.ts a@H1 @H1/file")
    expect(browserMentionRanges("(@H1), @H12", [heading])).toHaveLength(1)
    expect(maskBrowserMentions("@H1.ts @H1.", [heading])).toBe("@H1.ts    .")
  })
})
