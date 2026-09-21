import { describe, expect, it } from "vitest"
import { buildReasoningSummary } from "@/lib/reasoning-summary"

describe("buildReasoningSummary", () => {
  it("prefers markdown headings", () => {
    expect(buildReasoningSummary("# Inspecting provider runtime")).toBe(
      "Inspecting provider runtime"
    )
  })

  it("falls back to the first useful line", () => {
    expect(
      buildReasoningSummary("I should inspect the settings wiring first.\n\nNext")
    ).toBe("I should inspect the settings wiring first.")
  })

  it("returns null for empty reasoning", () => {
    expect(buildReasoningSummary(" \n ")).toBeNull()
  })
})
