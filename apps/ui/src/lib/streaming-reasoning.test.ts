import { describe, expect, it } from "vitest"
import type { ReasoningSegment } from "@/lib/chat/types"
import { combineStreamingReasoning } from "./streaming-reasoning"

function segment(text: string, startedAt: number | null, endedAt: number | null): ReasoningSegment {
  return { id: text, text, startedAt, endedAt }
}

describe("combined streaming reasoning", () => {
  it("preserves every phase followed by the live text without counting tool time", () => {
    expect(combineStreamingReasoning([
      segment("First read the files.", 100, 200),
      segment("Then check the tests.", 10_000, 12_000),
    ], "Now review the result.")).toEqual({
      text: "First read the files.\n\nThen check the tests.\n\nNow review the result.",
      durationSeconds: 2.1,
    })
  })

  it("keeps text with zero, missing or invalid timing and skips empty phases", () => {
    expect(combineStreamingReasoning([
      segment("Instant phase.", 100, 100),
      segment("Restored phase.", null, null),
      segment("Clock moved.", 500, 400),
      segment("Invalid clock.", NaN, 100),
      segment(" \n ", 10, 100_000),
    ], "  ")).toEqual({
      text: "Instant phase.\n\nRestored phase.\n\nClock moved.\n\nInvalid clock.",
      durationSeconds: 0,
    })
  })

  it("does not discard repeated text from distinct phases", () => {
    expect(combineStreamingReasoning([segment("Check again.", 0, 1000)], "Check again.").text)
      .toBe("Check again.\n\nCheck again.")
  })

  it("returns no disclosure content for an empty turn", () => {
    expect(combineStreamingReasoning([], "")).toEqual({ text: "", durationSeconds: 0 })
  })
})
