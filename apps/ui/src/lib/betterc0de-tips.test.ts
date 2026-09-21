import { describe, expect, it } from "vitest"
import { buildBetterC0deTipsMarkdown, BETTERC0DE_TIPS } from "@/lib/betterc0de-tips"

describe("BetterC0de tips", () => {
  it("renders workflow tips as chat markdown", () => {
    const output = buildBetterC0deTipsMarkdown()

    expect(BETTERC0DE_TIPS.length).toBeGreaterThan(5)
    expect(output).toContain("# BetterC0de Tips")
    expect(output).toContain("`/plan`")
    expect(output).toContain("`/keybinds`")
    expect(output).toContain("/help")
  })
})
