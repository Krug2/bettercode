/**
 * UI short-ID → Anthropic canonical model ID mapping (CJS twin of
 * `node-backend/src/provider/adapters/anthropicModelIds.ts`). Keep the two
 * in sync.
 *
 * Why this exists: BetterC0de stores provider-agnostic IDs like `opus-4-7`
 * in user preferences + plugin manifests so the same picker drives
 * API-key, OAuth, and CLI auth paths. The Anthropic API only accepts
 * fully-qualified `claude-*` slugs — passing bare `opus`/`sonnet`/`haiku`
 * 404s server-side (a previous version of this file returned them
 * unchanged and production hit `404 model: opus`).
 */

// Bare-name → latest canonical slug. Must stay in sync with the TS twin's
// BARE_NAME_TO_LATEST at node-backend/src/provider/adapters/anthropicModelIds.ts.
const BARE_NAME_TO_LATEST = {
  fable: "claude-fable-5-1",
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
}

function normalizeAnthropicModelId(id) {
  if (!id || typeof id !== "string") return undefined
  const trimmed = id.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("claude-")) return trimmed
  if (Object.hasOwn(BARE_NAME_TO_LATEST, trimmed)) return BARE_NAME_TO_LATEST[trimmed]
  if (/^(opus|sonnet|haiku|fable)-\d/.test(trimmed)) {
    return `claude-${trimmed}`
  }
  return trimmed
}

module.exports = { normalizeAnthropicModelId }
