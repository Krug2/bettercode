import { describe, expect, it } from "vitest"
import {
  CHAT_MODES,
  chatModeLabel,
  normalizeChatMode,
} from "@/lib/chat-mode-labels"

describe("normalizeChatMode", () => {
  it("keeps the modes that still exist", () => {
    for (const mode of CHAT_MODES) {
      expect(normalizeChatMode(mode), mode).toBe(mode)
    }
  })

  it("retires a mode stored before it was removed", () => {
    // Thread settings persist to localStorage. A chat last used in Security or
    // Debug would otherwise keep matching the mode-instruction lookups and
    // behave like a mode the user can no longer see or leave.
    for (const gone of ["security", "debug"]) {
      expect(normalizeChatMode(gone), gone).toBe("agent")
    }
  })

  it("falls back to Agent for anything unrecognised or missing", () => {
    for (const junk of [undefined, null, "", "   ", "whatever"]) {
      expect(normalizeChatMode(junk), String(junk)).toBe("agent")
    }
  })

  it("accepts stored values regardless of casing or padding", () => {
    expect(normalizeChatMode("  PLAN ")).toBe("plan")
    expect(normalizeChatMode("Ask")).toBe("ask")
  })
})

describe("chatModeLabel", () => {
  it("names the modes the composer offers", () => {
    expect(chatModeLabel("agent")).toBe("Agent")
    expect(chatModeLabel("plan")).toBe("Plan")
    // Named for what it guarantees, not for the word "ask" alone.
    expect(chatModeLabel("ask")).toBe("Ask / Read-only")
  })

  it("labels every mode that survives normalization", () => {
    for (const mode of CHAT_MODES) {
      expect(chatModeLabel(mode).trim().length, mode).toBeGreaterThan(0)
    }
  })
})
