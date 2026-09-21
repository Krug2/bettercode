import { describe, expect, it } from "vitest"
import { parseProviderKind } from "./types"

describe("parseProviderKind", () => {
  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "rejects inherited object key %s",
    (value) => expect(parseProviderKind(value)).toBeNull()
  )

  it.each([
    [" OpenAI-API ", "openai"],
    ["OPENAI_OAUTH", "openai"],
    ["anthropiccli", "anthropic_cli"],
    ["grok", "grok"],
  ])("preserves alias %s", (value, expected) => {
    expect(parseProviderKind(value)).toBe(expected)
  })
})
