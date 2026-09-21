/// <reference types="node" />
/**
 * Parity test for the main-process CJS files that mirror logic from the
 * TypeScript backend. The twin previously drifted silently and shipped a live
 * bug (the BARE_NAME_TO_LATEST omission caused a production
 * `404 model: opus`). This suite runs every documented input through both
 * implementations and asserts they produce identical output.
 *
 * Structure: instead of comparing the files token-by-token (which would
 * false-positive on harmless whitespace), we build a golden input table,
 * run both implementations against it, and require the outputs to match
 * element-by-element. Any drift trips exactly one assertion.
 *
 * The permission-matrix twin that used to live inline in
 * `claude-provider.cjs` is gone: that whole main-process bridge was removed
 * because it took its permission level from the renderer. There is now one
 * implementation of the matrix (`backend/src/provider/permissions.ts`) and
 * therefore nothing left to keep in sync — which is the outcome this test was
 * always a proxy for.
 */

import { describe, it, expect } from "vitest"
import { createRequire } from "node:module"
import { normalizeAnthropicModelId as tsNormalizeAnthropicModelId } from "../../../backend/src/provider/adapters/anthropicModelIds"

const requireCjs = createRequire(import.meta.url)
const cjsAnthropic = requireCjs(
  "../../../shell/shared/anthropicModelIds.cjs",
) as {
  normalizeAnthropicModelId: (id: string | null | undefined) => string | undefined
}

// ---------------------------------------------------------------------------
// anthropicModelIds — both twins MUST produce the same canonical ID.
// ---------------------------------------------------------------------------

const MODEL_ID_INPUTS: Array<string | null | undefined> = [
  // Canonical passthrough
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-3-5",
  // Bare names (the ones that caused the production 404)
  "opus",
  "sonnet",
  "haiku",
  "fable",
  // Versioned short form
  "opus-4-7",
  "sonnet-4-6",
  "sonnet-5",
  "fable-5",
  "haiku-4-5",
  // Unknown / custom
  "gpt-4o",
  "local-llama",
  "custom/namespace",
  // Whitespace
  "  opus  ",
  "",
  "   ",
  // Null / undefined
  null,
  undefined,
]

describe("anthropicModelIds CJS ↔ TS parity", () => {
  it.each(MODEL_ID_INPUTS.map((id) => [id]))(
    "normalizeAnthropicModelId(%s) agrees across twins",
    (id) => {
      expect(cjsAnthropic.normalizeAnthropicModelId(id as string)).toBe(
        tsNormalizeAnthropicModelId(id),
      )
    },
  )
})
