import { describe, expect, it } from "vitest"
import {
  anthropicContextLabel,
  anthropicModelDisplayName,
  anthropicModelTier,
  anthropicRequiresExplicitThinkingDisplay,
  anthropicSupportsAdaptiveThinking,
  anthropicSupportsExtendedEffort,
  anthropicSupportsFastMode,
  anthropicSupportsOneMillionContext,
  compareAnthropicModelIds,
  parseAnthropicModelId,
} from "@betterc0de/schema"

describe("parseAnthropicModelId", () => {
  it("reads family and generation from every slug shape in use", () => {
    expect(parseAnthropicModelId("claude-opus-4-8")).toEqual({
      family: "opus",
      version: 4.8,
    })
    expect(parseAnthropicModelId("claude-opus-5")).toEqual({
      family: "opus",
      version: 5,
    })
    expect(parseAnthropicModelId("opus-4.8")).toEqual({
      family: "opus",
      version: 4.8,
    })
    expect(parseAnthropicModelId("claude-haiku-4-5-20251001")).toEqual({
      family: "haiku",
      version: 4.5,
    })
    expect(parseAnthropicModelId("claude-sonnet-5[1m]")).toEqual({
      family: "sonnet",
      version: 5,
    })
    // A bare alias always resolves to the newest release in the family.
    expect(parseAnthropicModelId("opus")).toEqual({
      family: "opus",
      version: null,
    })
  })

  it("rejects non-Anthropic ids", () => {
    for (const id of ["gpt-5.6-sol", "grok-4.3", "composer-2", "", null]) {
      expect(parseAnthropicModelId(id)).toBeNull()
    }
  })
})

describe("capability derivation", () => {
  // Locks in the behaviour the hand-maintained slug lists used to encode, so
  // the generation rules are a refactor rather than a change.
  it("matches the curated list for every shipped model", () => {
    const oneMillion = [
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "opus",
      "sonnet",
    ]
    for (const id of oneMillion) {
      expect(anthropicSupportsOneMillionContext(id), id).toBe(true)
      expect(anthropicContextLabel(id), id).toBe("1M")
    }
    for (const id of ["claude-opus-4-5", "claude-haiku-4-5-20251001"]) {
      expect(anthropicSupportsOneMillionContext(id), id).toBe(false)
      expect(anthropicContextLabel(id), id).toBe("200K")
    }
  })

  it("gives the effort ladder to 4.6+ and extended effort to 4.7+ flagships", () => {
    for (const id of [
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
    ]) {
      expect(anthropicSupportsAdaptiveThinking(id), id).toBe(true)
    }
    expect(anthropicSupportsAdaptiveThinking("claude-opus-4-5")).toBe(false)
    expect(anthropicSupportsAdaptiveThinking("claude-haiku-4-5-20251001")).toBe(
      false
    )

    for (const id of [
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
    ]) {
      expect(anthropicSupportsExtendedEffort(id), id).toBe(true)
    }
    // Sonnet is not a flagship family, so it keeps the shorter ladder.
    for (const id of ["claude-sonnet-5", "claude-opus-4-6"]) {
      expect(anthropicSupportsExtendedEffort(id), id).toBe(false)
    }
  })

  it("requires the explicit thinking display opt-in from 4.7 on", () => {
    for (const id of [
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-fable-5",
      "claude-sonnet-5",
    ]) {
      expect(anthropicRequiresExplicitThinkingDisplay(id), id).toBe(true)
    }
    // Regression: Opus 5 fell outside the old `(opus|sonnet)-4-[78]` regex,
    // which would have silently dropped its thinking blocks.
    for (const id of ["claude-opus-4-6", "claude-sonnet-4-6"]) {
      expect(anthropicRequiresExplicitThinkingDisplay(id), id).toBe(false)
    }
  })

  it("keeps fast mode on the Opus 4.5/4.6 window only", () => {
    expect(anthropicSupportsFastMode("claude-opus-4-5")).toBe(true)
    expect(anthropicSupportsFastMode("claude-opus-4-6")).toBe(true)
    expect(anthropicSupportsFastMode("claude-opus-4-7")).toBe(false)
    expect(anthropicSupportsFastMode("claude-sonnet-4-6")).toBe(false)
  })

  it("assigns tiers and labels by family", () => {
    expect(anthropicModelTier("claude-opus-5")).toBe("Flagship")
    expect(anthropicModelTier("claude-fable-5")).toBe("Flagship")
    expect(anthropicModelTier("claude-sonnet-5")).toBe("Balanced")
    expect(anthropicModelTier("claude-haiku-4-5-20251001")).toBe("Fast")
    expect(anthropicModelDisplayName("claude-opus-5")).toBe("Claude Opus 5")
    expect(anthropicModelDisplayName("claude-opus-4-8")).toBe(
      "Claude Opus 4.8"
    )
    expect(anthropicModelDisplayName("claude-haiku-4-5-20251001")).toBe(
      "Claude Haiku 4.5"
    )
  })
})

describe("future models", () => {
  // The point of the taxonomy: a model nobody has hardcoded still lands with
  // the right capabilities, so live discovery can import it unattended.
  it("classifies an unreleased generation correctly", () => {
    expect(anthropicSupportsOneMillionContext("claude-opus-6")).toBe(true)
    expect(anthropicSupportsAdaptiveThinking("claude-opus-6")).toBe(true)
    expect(anthropicSupportsExtendedEffort("claude-opus-6")).toBe(true)
    expect(anthropicRequiresExplicitThinkingDisplay("claude-opus-6")).toBe(true)
    expect(anthropicModelTier("claude-opus-6")).toBe("Flagship")
    expect(anthropicModelDisplayName("claude-opus-6")).toBe("Claude Opus 6")
  })

  it("orders flagship families ahead of sonnet and haiku, newest first", () => {
    const sorted = [
      "claude-haiku-4-5-20251001",
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ].sort(compareAnthropicModelIds)
    expect(sorted).toEqual([
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ])
  })
})
