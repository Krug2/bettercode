import { describe, expect, it } from "vitest"
import { buildNativeThreadCompacterSelection } from "@/lib/native-compacter-selection"

describe("buildNativeThreadCompacterSelection", () => {
  it("keeps Codex as an explicit native compacter with Codex effort values", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "codex",
          providerKind: "codex",
          providerInstanceId: "codex",
        },
        selectedModel: "gpt-5.5",
        thinkingMode: "Ultra Think",
      })
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.5",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
    })
  })

  it("keeps Claude CLI as an explicit native compacter with Claude effort values", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "claude-work",
          providerKind: "claude",
          providerInstanceId: "claude-work",
        },
        selectedModel: "claude-opus-4-7",
        thinkingMode: "ExtraHigh",
      })
    ).toEqual({
      instanceId: "claude-work",
      model: "claude-opus-4-7",
      options: [
        { id: "effort", value: "max" },
        { id: "reasoningEffort", value: "max" },
      ],
    })
  })

  it("uses a direct Claude compacter when the active provider is Claude Terminal", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "claude-terminal",
          providerKind: "claude",
          providerInstanceId: "claude-terminal",
        },
        providers: [
          {
            id: "claude-terminal",
            providerKind: "claude",
            providerInstanceId: "claude-terminal",
          },
          {
            id: "claude",
            providerKind: "claude",
            providerInstanceId: "claude",
          },
        ],
        selectedModel: "claude-opus-4-7",
        thinkingMode: "Max",
      })
    ).toEqual({
      instanceId: "claude",
      model: "claude-opus-4-7",
      options: [
        { id: "effort", value: "max" },
        { id: "reasoningEffort", value: "max" },
      ],
    })
  })

  it("normalizes a previous Codex model when Claude Terminal hands off to direct Claude", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "claude-terminal",
          providerKind: "claude",
          providerInstanceId: "claude-terminal",
        },
        providers: [
          {
            id: "claude-terminal",
            providerKind: "claude",
            providerInstanceId: "claude-terminal",
          },
          {
            id: "claude",
            providerKind: "claude",
            providerInstanceId: "claude",
          },
        ],
        selectedModel: "gpt-5.5",
        thinkingMode: "ExtraHigh",
      })
    ).toEqual({
      instanceId: "claude",
      model: "claude-haiku-4-5",
      options: [
        { id: "effort", value: "max" },
        { id: "reasoningEffort", value: "max" },
      ],
    })
  })

  it("hands the selected Claude Terminal model to the backend mapper when direct Claude is hidden", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "claude-terminal",
          providerKind: "claude",
          providerInstanceId: "claude-terminal",
        },
        providers: [
          {
            id: "codex",
            providerKind: "codex",
            providerInstanceId: "codex",
          },
          {
            id: "claude-terminal",
            providerKind: "claude",
            providerInstanceId: "claude-terminal",
          },
          {
            id: "anthropic",
            providerKind: "anthropic",
            providerInstanceId: "anthropic",
          },
        ],
        selectedModel: "claude-opus-4-7",
        thinkingMode: "Max",
      })
    ).toEqual({
      instanceId: "claude-terminal",
      model: "claude-opus-4-7",
      options: [
        { id: "effort", value: "max" },
        { id: "reasoningEffort", value: "max" },
      ],
    })
  })

  it("does not use Claude API as the Claude Terminal compacter", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "claude-terminal",
          providerKind: "claude",
          providerInstanceId: "claude-terminal",
        },
        providers: [
          {
            id: "anthropic",
            providerKind: "anthropic",
            providerInstanceId: "anthropic",
          },
        ],
        selectedModel: "claude-opus-4-7",
        thinkingMode: "Max",
      })
    ).toEqual({
      instanceId: "claude-terminal",
      model: "claude-opus-4-7",
      options: [
        { id: "effort", value: "max" },
        { id: "reasoningEffort", value: "max" },
      ],
    })
  })

  it("falls back to a direct Claude compacter model when a Codex model is selected", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "claude",
          providerKind: "claude",
          providerInstanceId: "claude",
        },
        selectedModel: "gpt-5.5",
        thinkingMode: "ExtraHigh",
      })
    ).toEqual({
      instanceId: "claude",
      model: "claude-haiku-4-5",
      options: [
        { id: "effort", value: "max" },
        { id: "reasoningEffort", value: "max" },
      ],
    })
  })

  it("ignores non-native providers", () => {
    expect(
      buildNativeThreadCompacterSelection({
        provider: {
          id: "openrouter",
          providerKind: "openrouter",
          providerInstanceId: "openrouter",
        },
        selectedModel: "anthropic/claude-opus-4-7",
        thinkingMode: "high",
      })
    ).toBeNull()
  })
})
