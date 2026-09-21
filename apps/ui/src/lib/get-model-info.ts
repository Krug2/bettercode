import { builtinProviders } from "@/lib/builtin-providers"
import { usePluginStore } from "@/lib/plugin-store"

/**
 * Look up a model's display name + provider logo by model id, across both
 * builtin providers and enabled plugin providers.
 *
 * Returns `null` when `modelId` is falsy, and a fallback `{ name: modelId,
 * logo: "" }` when the id doesn't match anything (so callers can still
 * render *something* instead of blank). Reads the plugin store
 * imperatively via `getState()` because this function is also called from
 * non-reactive contexts (title generation, logging).
 */
export function getModelInfo(
  modelId?: string
): { name: string; logo: string } | null {
  if (!modelId) return null
  // Check all builtin providers
  for (const p of builtinProviders) {
    const model = p.models.find((m) => m.id === modelId)
    if (model) return { name: model.name, logo: p.logo || "" }
  }
  // Check plugin models
  const plugins = usePluginStore.getState().plugins
  for (const p of plugins) {
    if (!p.enabled) continue
    const model = p.manifest.models.find((m) => m.id === modelId)
    if (model) return { name: model.name, logo: p.manifest.icon || "" }
  }
  return { name: modelId, logo: "" }
}
