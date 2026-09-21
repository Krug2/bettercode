import type { UiProvider } from "@/lib/provider-types"

/** Fallback tooltip text per `authType` for providers that don't supply a
 *  `setupHint` from the backend. Keeps the renderer self-sufficient even
 *  when an old backend / a missing override leaves `setupHint` empty. */
const DEFAULT_HINT_BY_AUTH_TYPE: Record<string, string> = {
  "api-key": "Not set up — add an API key in Settings.",
  cli: "Not set up — CLI not installed or not signed in.",
  "local-server": "Not set up — local server not reachable.",
  oauth: "Not set up — sign-in required.",
}

const GENERIC_HINT = "Not set up."

/**
 * Resolves the on-hover tooltip text for an unconfigured provider entry
 * in the model picker. Priority:
 *   1. `provider.setupHint` from the backend (most specific).
 *   2. Per-`authType` default copy.
 *   3. Generic "Nicht eingerichtet." fallback.
 *
 * Returns `undefined` for configured providers so the dropdown items
 * can be rendered without a tooltip wrapper at all.
 */
export function resolveProviderSetupHint(
  provider: Pick<UiProvider, "configured" | "authType" | "setupHint">,
): string | undefined {
  if (provider.configured !== false) return undefined
  if (provider.setupHint) return provider.setupHint
  if (provider.authType && DEFAULT_HINT_BY_AUTH_TYPE[provider.authType]) {
    return DEFAULT_HINT_BY_AUTH_TYPE[provider.authType]
  }
  return GENERIC_HINT
}

/** Convenience predicate: a provider entry should render disabled when
 *  the backend has explicitly reported `configured: false`. `undefined`
 *  status (= "not yet fetched") leaves the entry enabled to avoid a
 *  flash of disabled UI on first paint. */
export function isProviderUnconfigured(
  provider: Pick<UiProvider, "configured">,
): boolean {
  return provider.configured === false
}
