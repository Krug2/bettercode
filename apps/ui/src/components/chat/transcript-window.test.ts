import { describe, expect, it } from "vitest"
import {
  TRANSCRIPT_WINDOW_SIZE,
  windowTranscriptEntries,
} from "./transcript-window"

describe("windowTranscriptEntries", () => {
  it("does not return every historical entry when the transcript is long", () => {
    const entries = Array.from({ length: 200 }, (_, index) => index)
    const windowed = windowTranscriptEntries(entries)

    expect(windowed.visible).toHaveLength(TRANSCRIPT_WINDOW_SIZE)
    expect(windowed.hiddenBefore).toBe(200 - TRANSCRIPT_WINDOW_SIZE)
    expect(windowed.visible[0]).toBe(200 - TRANSCRIPT_WINDOW_SIZE)
    expect(windowed.visible.at(-1)).toBe(199)
    expect(windowed.visible).not.toContain(0)
  })

  it("can expand the window toward older history without mounting the full list", () => {
    const entries = Array.from({ length: 80 }, (_, index) => `m-${index}`)
    const windowed = windowTranscriptEntries(entries, {
      size: 10,
      startIndex: 20,
    })

    expect(windowed.visible).toEqual(
      Array.from({ length: 60 }, (_, index) => `m-${20 + index}`)
    )
    expect(windowed.hiddenBefore).toBe(20)
    expect(windowed.visible).not.toContain("m-0")
  })
})
