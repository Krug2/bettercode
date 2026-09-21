import { useEffect, useMemo } from "react"
import { resolveProviderModelThinkingSelection } from "@/lib/provider-model-selection"
import type { UiProvider } from "@/lib/provider-types"

/**
 * Resolves the currently-selected provider/model pair from the user's
 * preferences + the provider list, with fallback logic for when the
 * preferred provider no longer owns the selected model (e.g. after a
 * provider is removed or a model is moved).
 *
 * Also keeps three persisted prefs in sync with the derived value:
 *  - `selectedProviderId` — if `useMemo` picked a different provider
 *    than the stored preference (e.g. because the fallback triggered),
 *    we write the new id back so next reload remembers the fallback.
 *  - `selectedModel` — if the selected provider no longer owns the stored
 *    model, we persist the provider's default model.
 *  - `thinkingMode` — if the current mode isn't supported by the
 *    provider/model combo, `coerceThinkingModeForModel` moves it to
 *    the closest descriptor-backed option and persists that value.
 */
export function useSelectedProvider({
  providers,
  selectedProviderId,
  setSelectedProviderId,
  selectedModel,
  setSelectedModel,
  thinkingMode,
  setThinkingMode,
  lockedProviderInstanceId,
  lockedContinuationKey,
}: {
  providers: UiProvider[]
  selectedProviderId: string
  setSelectedProviderId: (id: string) => void
  selectedModel: string
  setSelectedModel: (id: string, providerId?: string) => void
  thinkingMode: string | null
  setThinkingMode: (mode: string | null, providerId?: string) => void
  lockedProviderInstanceId?: string | null
  lockedContinuationKey?: string | null
}) {
  const selection = useMemo(() => {
    return resolveProviderModelThinkingSelection({
      providers,
      selectedProviderId,
      selectedModel,
      thinkingMode,
      lockedProviderInstanceId,
      lockedContinuationKey,
    })
  }, [
    providers,
    selectedProviderId,
    selectedModel,
    thinkingMode,
    lockedProviderInstanceId,
    lockedContinuationKey,
  ])
  const selectedProvider = selection.provider
  const resolvedModelId = selection.modelId
  const resolvedThinkingMode = selection.thinkingMode
  // Initial catalogs are placeholders. Keep the stored choice until the
  // fallback provider has actually been probed, including its model metadata.
  const canPersistSelection =
    selectedProvider?.id === selectedProviderId ||
    (selectedProvider?.configured === true &&
      selectedProvider.modelsReady !== false)

  useEffect(() => {
    if (!canPersistSelection) return
    if (selectedProvider?.id && selectedProvider.id !== selectedProviderId) {
      setSelectedProviderId(selectedProvider.id)
    }
  }, [
    canPersistSelection,
    selectedProvider,
    selectedProviderId,
    setSelectedProviderId,
  ])

  useEffect(() => {
    if (!canPersistSelection) return
    if (resolvedModelId !== selectedModel) {
      setSelectedModel(resolvedModelId, selectedProvider?.id)
    }
  }, [
    canPersistSelection,
    resolvedModelId,
    selectedModel,
    selectedProvider,
    setSelectedModel,
  ])

  useEffect(() => {
    if (!canPersistSelection) return
    if (resolvedThinkingMode !== thinkingMode) {
      setThinkingMode(resolvedThinkingMode, selectedProvider?.id)
    }
  }, [
    canPersistSelection,
    resolvedThinkingMode,
    thinkingMode,
    selectedProvider,
    setThinkingMode,
  ])

  return {
    selectedProvider,
    selectedModel: resolvedModelId,
    thinkingMode: resolvedThinkingMode,
  }
}
