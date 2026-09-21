import { describe, it, expect } from "vitest"
import {
  isClaudeFable5,
  isClaudeOpus47,
  isClaudeOpusOrSonnet,
} from "./anthropic-model"

describe("isClaudeOpusOrSonnet", () => {
  it.each([
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-opus-4-5",
    "claude-fable-5",
    "opus-4-7",
    "sonnet-4-6",
    "sonnet-5",
    "fable-5",
    "opus",
    "sonnet",
    "fable",
    "OPUS-4-7", // case-insensitive
  ])("matches %s", (id) => {
    expect(isClaudeOpusOrSonnet(id)).toBe(true)
  })

  it.each([
    "claude-haiku-4-5",
    "haiku",
    "gpt-4o",
    "",
    null,
    undefined,
  ])("rejects %p", (id) => {
    expect(isClaudeOpusOrSonnet(id as string | null | undefined)).toBe(false)
  })
})

describe("isClaudeOpus47", () => {
  // Regression: the composer footer had a brittle `selectedModel === "opus-4-7"`
  // check that never matched the canonical `claude-opus-4-7` ID stored in
  // the static built-in model lists. The Opus-4.7-only label branch
  // (xHigh + Max) therefore never lit up.
  it.each([
    "claude-opus-4-7",
    "claude-opus-4.7",
    "opus-4-7",
    "opus-4.7",
    "claude-opus47",
    "opus47",
    "Opus-4-7", // case-insensitive
    "CLAUDE-OPUS-4-7",
  ])("matches %s", (id) => {
    expect(isClaudeOpus47(id)).toBe(true)
  })

  it.each([
    // Bare `opus` deliberately does NOT match — it means "latest Opus"
    // and would need updating when 4.8 ships.
    "opus",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "opus-4-5",
    "claude-sonnet-4-6",
    "sonnet",
    "haiku",
    "claude-opus",
    "opus-4-8", // future version — explicit 4.7 only
    "",
    null,
    undefined,
  ])("rejects %p", (id) => {
    expect(isClaudeOpus47(id as string | null | undefined)).toBe(false)
  })
})

describe("isClaudeFable5", () => {
  // Fable 5 gets the flagship thinking menu (xHigh/Max/Ultrathink) via
  // getFallbackThinkingOptions — this matcher gates that branch.
  it.each([
    "claude-fable-5",
    "claude-fable.5",
    "fable-5",
    "fable.5",
    "FABLE-5", // case-insensitive
    "CLAUDE-FABLE-5",
  ])("matches %s", (id) => {
    expect(isClaudeFable5(id)).toBe(true)
  })

  it.each([
    // Bare `fable` deliberately does NOT match — it means "latest Fable"
    // and would need updating when a newer Fable ships.
    "fable",
    "claude-fable",
    "fable-4",
    "claude-sonnet-5",
    "sonnet-5",
    "claude-opus-4-8",
    "",
    null,
    undefined,
  ])("rejects %p", (id) => {
    expect(isClaudeFable5(id as string | null | undefined)).toBe(false)
  })
})
