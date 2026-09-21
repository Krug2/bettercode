/**
 * API-key resolution helpers — thin wrappers over the per-provider registry
 * in `apps/backend/src/provider/registry/`. Each `resolve<X>Key` function
 * exists for backward compatibility with the bootstrap phases (formerly
 * `inProcess.ts`); the actual logic
 * (settings → env vars → CLI config) lives in `registry/types.ts`.
 *
 * Adding a new provider does NOT require a new function here — call
 * `resolveApiKeyFor(id, settings)` instead.
 */

import type { Settings } from "../settings/schema";
import {
  getProvider,
  resolveProviderApiKey,
  type ResolvedApiKey,
  type KeySource,
} from "../provider/catalog";

export type { KeySource, ResolvedApiKey };

/** Generic resolver — preferred for new code. */
export function resolveApiKeyFor(
  providerId: string,
  settings: Settings,
): ResolvedApiKey | null {
  const def = getProvider(providerId);
  if (!def) return null;
  return resolveProviderApiKey(def, settings);
}

// ── Back-compat named exports ─────────────────────────────────────────────
// Kept so existing call sites in bootstrap/ and elsewhere don't need to
// change. New code should call `resolveApiKeyFor` directly.

export const resolveOpenAiKey = (settings: Settings) => resolveApiKeyFor("openai", settings);
export const resolveAnthropicKey = (settings: Settings) => resolveApiKeyFor("anthropic", settings);
export const resolveGrokKey = (settings: Settings) => resolveApiKeyFor("grok", settings);
export const resolveOpenRouterKey = (settings: Settings) => resolveApiKeyFor("openrouter", settings);
