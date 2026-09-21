import type { ContextWindow } from "@/lib/preferences-store"
import type { ProviderOptionSelection } from "@betterc0de/schema"

export interface ProviderComposerSelection {
  selectedModel?: string
  thinkingMode?: string | null
  contextWindow?: ContextWindow
  fastMode?: boolean
  optionSelections?: ProviderOptionSelection[]
}

export type ProviderComposerSelectionMap = Record<
  string,
  ProviderComposerSelection
>

export function getProviderComposerSelection(
  providerId: string | null | undefined,
  ...maps: ReadonlyArray<ProviderComposerSelectionMap | null | undefined>
): ProviderComposerSelection | undefined {
  if (!providerId) return undefined
  let merged: ProviderComposerSelection | undefined
  for (const map of maps) {
    const selection = map?.[providerId]
    if (!selection) continue
    merged = { ...(merged ?? {}), ...selection }
  }
  return merged
}

export function upsertProviderComposerSelection(
  map: ProviderComposerSelectionMap | null | undefined,
  providerId: string | null | undefined,
  patch: ProviderComposerSelection
): ProviderComposerSelectionMap {
  if (!providerId) return { ...(map ?? {}) }
  const current = map?.[providerId] ?? {}
  return {
    ...(map ?? {}),
    [providerId]: { ...current, ...patch },
  }
}
