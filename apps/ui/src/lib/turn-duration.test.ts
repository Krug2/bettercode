import { describe, expect, it } from "vitest"
import { MAX_PLAUSIBLE_TURN_MS, turnDurationMs } from "@/lib/turn-duration"

const BASE = Date.parse("2026-08-22T12:00:00.000Z")

function at(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString()
}

describe("turnDurationMs", () => {
  it("measures from the triggering user message to the reply", () => {
    const messages = [
      { role: "user", createdAt: at(0) },
      { role: "assistant", createdAt: at(63_000) },
    ]
    expect(turnDurationMs(messages, 1)).toBe(63_000)
  })

  it("uses the nearest preceding user message, not the first", () => {
    const messages = [
      { role: "user", createdAt: at(0) },
      { role: "assistant", createdAt: at(10_000) },
      { role: "user", createdAt: at(20_000) },
      { role: "assistant", createdAt: at(25_000) },
    ]
    expect(turnDurationMs(messages, 3)).toBe(5_000)
  })

  it("skips intervening system messages when finding the trigger", () => {
    const messages = [
      { role: "user", createdAt: at(0) },
      { role: "system", createdAt: at(1_000) },
      { role: "assistant", createdAt: at(4_000) },
    ]
    expect(turnDurationMs(messages, 2)).toBe(4_000)
  })

  it("reports nothing for a reply with no preceding user message", () => {
    expect(
      turnDurationMs([{ role: "assistant", createdAt: at(1_000) }], 0)
    ).toBeNull()
  })

  it("reports nothing for a user message", () => {
    const messages = [
      { role: "user", createdAt: at(0) },
      { role: "user", createdAt: at(1_000) },
    ]
    expect(turnDurationMs(messages, 1)).toBeNull()
  })

  // Restored or imported histories carry timestamps from other machines; a
  // number measured across those is worse than no number.
  it("suppresses implausible and non-positive spans", () => {
    expect(
      turnDurationMs(
        [
          { role: "user", createdAt: at(0) },
          { role: "assistant", createdAt: at(MAX_PLAUSIBLE_TURN_MS + 1) },
        ],
        1
      )
    ).toBeNull()
    expect(
      turnDurationMs(
        [
          { role: "user", createdAt: at(5_000) },
          { role: "assistant", createdAt: at(0) },
        ],
        1
      )
    ).toBeNull()
  })

  it("accepts a span exactly at the cap", () => {
    expect(
      turnDurationMs(
        [
          { role: "user", createdAt: at(0) },
          { role: "assistant", createdAt: at(MAX_PLAUSIBLE_TURN_MS) },
        ],
        1
      )
    ).toBe(MAX_PLAUSIBLE_TURN_MS)
  })

  it("reports nothing for missing or unparsable timestamps", () => {
    expect(
      turnDurationMs(
        [
          { role: "user", createdAt: "not a date" },
          { role: "assistant", createdAt: at(1_000) },
        ],
        1
      )
    ).toBeNull()
    expect(
      turnDurationMs(
        [{ role: "user", createdAt: at(0) }, { role: "assistant" }],
        1
      )
    ).toBeNull()
  })

  it("reports nothing for an out-of-range index", () => {
    expect(turnDurationMs([], 0)).toBeNull()
    expect(turnDurationMs([{ role: "assistant", createdAt: at(0) }], 5)).toBeNull()
  })
})
