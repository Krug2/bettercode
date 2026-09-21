import { describe, expect, it } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import {
  chatActivityLabel,
  chatModelSelection,
  chatProjectLabel,
} from "./chat-switcher-details"

describe("chat history metadata", () => {
  it("prefers the actual assistant model over a later composer selection", () => {
    const thread = {
      lastModelId: "old",
      messages: [
        { role: "assistant", modelId: "claude-opus-4-6" },
        { role: "user", modelId: "selected-only" },
      ],
    } as ChatThread
    expect(chatModelSelection(thread, "gpt-6-astra")).toEqual({
      id: "claude-opus-4-6",
      source: "used",
    })
    expect(
      chatModelSelection({ ...thread, messages: [] }, "gpt-6-astra")
    ).toEqual({ id: "old", source: "used" })
  })

  it("identifies selection-only and missing metadata honestly", () => {
    expect(chatModelSelection(undefined, "gpt-6-astra")).toEqual({
      id: "gpt-6-astra",
      source: "selected",
    })
    expect(chatModelSelection(undefined)).toEqual({ source: "unknown" })
  })

  it("handles project paths and invalid or future activity dates", () => {
    expect(
      chatProjectLabel({ projectPath: "C:\\work\\shop\\" } as ChatThread)
    ).toBe("shop")
    expect(chatProjectLabel(undefined)).toBe("No project")
    expect(chatActivityLabel("invalid", 0)).toBe("")
    expect(
      chatActivityLabel(
        "2026-09-14T12:00:00Z",
        Date.parse("2026-09-14T11:00:00Z")
      )
    ).toBe("Just now")
  })
})
