import { describe, expect, it } from "vitest"
import {
  getProviderComposerSelection,
  upsertProviderComposerSelection,
} from "@/lib/provider-composer-selection"

describe("provider composer selection", () => {
  it("merges provider-scoped selections with later maps overriding earlier maps", () => {
    expect(
      getProviderComposerSelection(
        "claude",
        {
          claude: {
            selectedModel: "claude-opus-4-7",
            thinkingMode: "max",
            contextWindow: "1m",
          },
        },
        {
          claude: {
            thinkingMode: "ultrathink",
          },
        }
      )
    ).toEqual({
      selectedModel: "claude-opus-4-7",
      thinkingMode: "ultrathink",
      contextWindow: "1m",
    })
  })

  it("keeps codex and claude model selections isolated", () => {
    const withCodex = upsertProviderComposerSelection({}, "codex", {
      selectedModel: "gpt-5.5",
      thinkingMode: "xHigh",
      fastMode: true,
    })
    const withClaude = upsertProviderComposerSelection(withCodex, "claude", {
      selectedModel: "claude-opus-4-7",
      thinkingMode: "max",
      contextWindow: "1m",
    })

    expect(getProviderComposerSelection("codex", withClaude)).toEqual({
      selectedModel: "gpt-5.5",
      thinkingMode: "xHigh",
      fastMode: true,
    })
    expect(getProviderComposerSelection("claude", withClaude)).toEqual({
      selectedModel: "claude-opus-4-7",
      thinkingMode: "max",
      contextWindow: "1m",
    })
  })

  it("preserves explicit off/null thinking mode per provider", () => {
    const map = upsertProviderComposerSelection({}, "claude", {
      thinkingMode: null,
    })

    expect(getProviderComposerSelection("claude", map)).toEqual({
      thinkingMode: null,
    })
  })

  it("keeps fast mode as a provider-scoped model option", () => {
    const map = upsertProviderComposerSelection(
      upsertProviderComposerSelection({}, "codex", { fastMode: true }),
      "claude",
      { fastMode: false }
    )

    expect(getProviderComposerSelection("codex", map)?.fastMode).toBe(true)
    expect(getProviderComposerSelection("claude", map)?.fastMode).toBe(false)
  })

  it("keeps provider option selections scoped with the composer model state", () => {
    const map = upsertProviderComposerSelection({}, "BetterC0de", {
      selectedModel: "anthropic/claude-sonnet-4-6",
      optionSelections: [{ id: "variant", value: "xhigh" }],
    })

    expect(getProviderComposerSelection("BetterC0de", map)).toEqual({
      selectedModel: "anthropic/claude-sonnet-4-6",
      optionSelections: [{ id: "variant", value: "xhigh" }],
    })
  })
})
