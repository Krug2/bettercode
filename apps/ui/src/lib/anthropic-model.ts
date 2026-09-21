/**
 * Helpers for inspecting an Anthropic model identifier from UI code.
 *
 * Model IDs in BetterC0de come in three historical shapes — canonical
 * (`claude-opus-4-7`), short (`opus-4-7`), and bare (`opus`). The bare
 * form was a renderer-only convention that leaked into Anthropic's API
 * and got rejected with `404 model: opus` (real Anthropic IDs are always
 * `claude-*`). The fix moved the static UI lists onto canonical IDs;
 * this helper makes capability checks (e.g. "show context-window picker
 * for Opus / Sonnet") robust against all three shapes so a stray bare
 * name from settings, a plugin, or older persisted state doesn't break
 * the UI.
 */

// Fable (the Claude 5 Mythos-class flagship) is included: it sits above
// Opus and supports the same context-window / thinking surface.
const OPUS_OR_SONNET_REGEX = /^(claude-)?(opus|sonnet|fable)(-|$)/i

/** True if `id` refers to any Opus, Sonnet, or Fable variant (canonical or short). */
export function isClaudeOpusOrSonnet(id: string | null | undefined): boolean {
  if (!id) return false
  return OPUS_OR_SONNET_REGEX.test(id)
}

// Opus 4.7 specifically — matches both the canonical `claude-opus-4-7`
// slug and the short `opus-4-7` (or compact `opus47`) shapes the UI
// has historically used. Intentionally does NOT match the bare `opus`
// alias even though it currently resolves to 4.7 server-side, because
// the bare form means "latest Opus" and would need updating whenever a
// new Opus ships.
const OPUS_47_REGEX = /^(claude-)?opus[-.]?4[-.]?7$/i

/** True if `id` refers specifically to Claude Opus 4.7. */
export function isClaudeOpus47(id: string | null | undefined): boolean {
  if (!id) return false
  return OPUS_47_REGEX.test(id)
}

// Fable 5 — the Claude 5 family flagship (Mythos class, above Opus). Gets
// the same flagship thinking menu (xHigh/Max/Ultrathink) as Opus 4.7/4.8.
const FABLE_5_REGEX = /^(claude-)?fable[-.]?5$/i

/** True if `id` refers specifically to Claude Fable 5. */
export function isClaudeFable5(id: string | null | undefined): boolean {
  if (!id) return false
  return FABLE_5_REGEX.test(id)
}
