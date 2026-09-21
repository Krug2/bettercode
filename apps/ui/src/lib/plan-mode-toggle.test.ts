import { describe, expect, it } from "vitest"
import {
  DEFAULT_CHAT_MODE,
  PLAN_CHAT_MODE,
  togglePlanMode,
} from "@/lib/plan-mode-toggle"

describe("togglePlanMode", () => {
  it("switches into Plan from anywhere else", () => {
    for (const from of ["agent", "ask"]) {
      expect(togglePlanMode(from).next, from).toBe(PLAN_CHAT_MODE)
    }
  })

  it("remembers where it came from", () => {
    expect(togglePlanMode("ask")).toEqual({
      next: PLAN_CHAT_MODE,
      remember: "ask",
    })
  })

  it("returns to the remembered mode, not a fixed one", () => {
    // Leaving Plan must not drop the user out of Ask / Read-only into a mode
    // that is allowed to write.
    expect(togglePlanMode(PLAN_CHAT_MODE, "ask")).toEqual({
      next: "ask",
      remember: null,
    })
  })

  it("falls back to Agent when nothing is remembered", () => {
    for (const remembered of [undefined, null, "", "   "]) {
      expect(
        togglePlanMode(PLAN_CHAT_MODE, remembered).next,
        String(remembered)
      ).toBe(DEFAULT_CHAT_MODE)
    }
  })

  it("never returns into Plan itself", () => {
    // A stale "remembered = plan" would make the toggle a no-op and strand
    // the user in Plan with no way out from the keyboard.
    expect(togglePlanMode(PLAN_CHAT_MODE, PLAN_CHAT_MODE).next).toBe(
      DEFAULT_CHAT_MODE
    )
  })

  it("treats a missing current mode as Agent", () => {
    for (const current of [undefined, null, "", "  "]) {
      expect(togglePlanMode(current), String(current)).toEqual({
        next: PLAN_CHAT_MODE,
        remember: DEFAULT_CHAT_MODE,
      })
    }
  })

  it("is its own inverse", () => {
    for (const start of ["agent", "ask"]) {
      const on = togglePlanMode(start)
      const off = togglePlanMode(on.next, on.remember)
      expect(off.next, start).toBe(start)
    }
  })
})
