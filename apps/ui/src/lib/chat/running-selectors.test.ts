import { describe, expect, it } from "vitest"
import { formatRunningElapsed } from "./running-selectors"

const START = Date.parse("2026-08-21T12:00:00.000Z")

function after(seconds: number): number {
  return START + seconds * 1000
}

describe("formatRunningElapsed", () => {
  it("counts seconds for the first minute", () => {
    expect(formatRunningElapsed(START, after(0))).toBe("0s")
    expect(formatRunningElapsed(START, after(1))).toBe("1s")
    expect(formatRunningElapsed(START, after(59))).toBe("59s")
  })

  it("switches to minutes and seconds", () => {
    expect(formatRunningElapsed(START, after(60))).toBe("1m 0s")
    expect(formatRunningElapsed(START, after(94))).toBe("1m 34s")
    expect(formatRunningElapsed(START, after(59 * 60 + 59))).toBe("59m 59s")
  })

  it("switches to hours and minutes for a long run", () => {
    expect(formatRunningElapsed(START, after(60 * 60))).toBe("1h 0m")
    expect(formatRunningElapsed(START, after(2 * 60 * 60 + 7 * 60))).toBe(
      "2h 7m"
    )
  })

  // Clock adjustments must not render a negative duration on a card.
  it("never goes negative", () => {
    expect(formatRunningElapsed(START, after(-30))).toBe("0s")
  })
})
