import { describe, expect, it } from "vitest"
import { clampDiffFileListWidth, maxDiffFileListWidth } from "./diff-layout"

describe("diff file-list sizing", () => {
  it("keeps room for code when the containing pane gets narrower", () => {
    expect(clampDiffFileListWidth(500, 720)).toBe(460)
    expect(clampDiffFileListWidth(500, 500)).toBe(240)
  })

  it("keeps the file list usable and caps expansion on wide screens", () => {
    expect(clampDiffFileListWidth(0, 1200)).toBe(220)
    expect(clampDiffFileListWidth(9000, 1800)).toBe(640)
    expect(maxDiffFileListWidth(400)).toBe(220)
  })

  it("retains a saved preference when resizing the outer pane and falls back for invalid data", () => {
    const savedWidth = 400
    expect(clampDiffFileListWidth(savedWidth, 550)).toBe(290)
    expect(clampDiffFileListWidth(savedWidth, 1100)).toBe(savedWidth)
    expect(clampDiffFileListWidth(Number.NaN, 1100)).toBe(280)
  })
})
