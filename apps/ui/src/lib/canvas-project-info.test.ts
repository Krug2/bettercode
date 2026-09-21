import { describe, expect, it } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import { canvasModelSelection } from "./canvas-project-info"

const thread = {
  messages: [],
  lastModelId: "previous-model",
} as unknown as ChatThread

describe("canvas model metadata", () => {
  it("shows a changed selection instead of the previous answer when idle", () => {
    expect(
      canvasModelSelection(
        thread,
        { selectedModel: "next-model" },
        "previous-model",
        false
      )
    ).toEqual({ id: "next-model", source: "selected" })
  })
  it("keeps the running model even if the next selection changes", () => {
    expect(
      canvasModelSelection(
        thread,
        { selectedModel: "next-model" },
        "running-model",
        true
      )
    ).toEqual({ id: "running-model", source: "current" })
  })
  it("uses this thread's provider-scoped model without leaking another provider's selection", () => {
    expect(
      canvasModelSelection(
        thread,
        {
          selectedProviderId: "codex-instance",
          selectedModel: "legacy",
          modelSelectionByProvider: {
            "claude-instance": { selectedModel: "other-provider" },
            "codex-instance": { selectedModel: "scoped-model" },
          },
        },
        null,
        false
      )
    ).toEqual({ id: "scoped-model", source: "selected" })
  })
  it("labels recovered metadata as last used until the live model arrives", () => {
    expect(
      canvasModelSelection(thread, { selectedModel: "next-model" }, null, true)
    ).toEqual({ id: "previous-model", source: "used" })
  })
  it("does not invent a model for a chat without settings or history", () => {
    expect(canvasModelSelection(undefined, undefined, null, false)).toEqual({
      source: "unknown",
    })
    expect(
      canvasModelSelection(thread, undefined, "stale-stream", false)
    ).toEqual({ id: "previous-model", source: "used" })
  })
})
