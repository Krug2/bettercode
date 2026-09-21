import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { normalizeAnthropicModelId } = require("../apps/shell/shared/anthropicModelIds.cjs")

test("Anthropic model aliases leave inherited property names as custom IDs", () => {
  for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(normalizeAnthropicModelId(` ${id} `), id)
  }
  assert.equal(normalizeAnthropicModelId("opus"), "claude-opus-5")
  assert.equal(normalizeAnthropicModelId("sonnet-4-6"), "claude-sonnet-4-6")
  assert.equal(normalizeAnthropicModelId("claude-custom"), "claude-custom")
  assert.equal(normalizeAnthropicModelId("  "), undefined)
})
