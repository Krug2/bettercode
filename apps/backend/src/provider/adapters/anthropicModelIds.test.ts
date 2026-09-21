import { describe, expect, it } from "vitest"
import { normalizeAnthropicModelId } from "./anthropicModelIds"

describe("normalizeAnthropicModelId", () => {
  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "preserves custom model %s as a string",
    (value) => expect(normalizeAnthropicModelId(value)).toBe(value)
  )

  it.each([
    [" opus ", "claude-opus-5"],
    ["sonnet-5", "claude-sonnet-5"],
    ["claude-fable-5-1", "claude-fable-5-1"],
    ["custom-model", "custom-model"],
  ])("normalizes model %s", (value, expected) => {
    expect(normalizeAnthropicModelId(value)).toBe(expected)
  })

  it.each([null, undefined, "", "   "])("ignores empty model %s", (value) => {
    expect(normalizeAnthropicModelId(value)).toBeUndefined()
  })
})
