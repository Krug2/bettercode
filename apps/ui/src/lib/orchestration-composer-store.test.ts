import { describe, expect, it } from "vitest"
import {
  orchestrationForMain,
  type ChatOrchestration,
} from "@betterc0de/schema"
import { savedOrchestration } from "./orchestration-composer-store"

describe("orchestration follows the main model picker", () => {
  it.each([
    { main: "grok_cli", workers: ["claude", "codex"] },
    { main: "claude", workers: ["codex", "grok_cli"] },
    { main: "codex", workers: ["claude", "grok_cli"] },
  ])(
    "excludes $main from agent selection without mutating saved preferences",
    ({ main, workers }) => {
      const saved = savedOrchestration({
        enabled: true,
        providers: ["claude", "codex", "grok_cli"],
      })
      expect(orchestrationForMain(saved, main)).toEqual({
        enabled: true,
        providers: workers,
      })
      expect(saved).toEqual({
        enabled: true,
        providers: ["claude", "codex", "grok_cli"],
      })
    }
  )
  it("does not silently enable another provider when the selected worker becomes main", () => {
    const saved: ChatOrchestration = { enabled: true, providers: ["codex"] }
    expect(orchestrationForMain(saved, "codex")).toEqual({ enabled: false })
    expect(orchestrationForMain(saved, "grok_cli")).toEqual(saved)
    expect(orchestrationForMain({ enabled: false }, "claude")).toEqual({
      enabled: false,
    })
  })
  it("rejects unsupported, duplicate and empty saved worker selections", () => {
    for (const providers of [["openai"], ["claude", "claude"], []])
      expect(savedOrchestration({ enabled: true, providers })).toEqual({
        enabled: false,
      })
  })
})
