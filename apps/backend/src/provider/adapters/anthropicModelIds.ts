/**
 * UI short-ID → Anthropic canonical model ID mapping.
 *
 * The BetterC0de UI stores provider-agnostic short IDs (`opus-4-7`,
 * `sonnet-4-6`, `haiku-4-5`, or even bare `opus` / `sonnet` / `haiku`)
 * so the same model picker works across API-key, OAuth, and CLI auth
 * paths. The Anthropic API only accepts fully-qualified `claude-*`
 * slugs — there is NO server-side `opus`/`sonnet`/`haiku` alias (a
 * previous version of this file claimed otherwise; production proved
 * the assumption wrong with `404 model: opus`).
 *
 * This helper bridges the gap at the adapter boundary so the UI
 * contract stays stable.
 */

// Bare-name → latest canonical slug. Update when newer model versions
// ship (keep in sync with claudeApi.ts `availableModels()`).
const BARE_NAME_TO_LATEST: Record<string, string> = {
  fable: "claude-fable-5-1",
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
};

export function normalizeAnthropicModelId(
  id: string | null | undefined,
): string | undefined {
  if (!id || typeof id !== "string") return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;

  // Pass-through: already canonical `claude-*` form.
  if (trimmed.startsWith("claude-")) return trimmed;

  // Bare names — map to the latest canonical slug. The Anthropic API
  // returns 404 on these alone; the UI's static model lists historically
  // used them as IDs, and any other code path that does so still works
  // through this fallback.
  if (Object.hasOwn(BARE_NAME_TO_LATEST, trimmed)) return BARE_NAME_TO_LATEST[trimmed];

  // Normalize: versioned short form (`opus-4-7`, `sonnet-5`, `fable-5`,
  // `haiku-4-5`) is the UI convention; prefix with `claude-` so the API
  // accepts it.
  if (/^(opus|sonnet|haiku|fable)-\d/.test(trimmed)) {
    return `claude-${trimmed}`;
  }

  // Unknown provider-specific ID (e.g. custom via settings) — return
  // verbatim so users with exotic configurations aren't blocked.
  return trimmed;
}
