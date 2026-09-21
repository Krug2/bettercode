import { resolveThreadProviderSelection } from "@/lib/composer-settings"
export { resolveComposerPreferences } from "@/lib/composer-settings"
import { useChatStore } from "@/lib/chat-store"
import { recordModelSwitch } from "@/lib/model-switch-activity"
import { usePreferencesStore } from "@/lib/preferences-store"
import {
  upsertProviderComposerSelection,
  type ProviderComposerSelection,
} from "@/lib/provider-composer-selection"

export function updateProviderComposerSelection(
  threadId: string | null,
  providerId: string | undefined,
  patch: ProviderComposerSelection
): void {
  // A single dropdown click updates model, context and reasoning before React
  // renders again. Each patch must merge into the latest stores, not the
  // snapshot captured by the click handler.
  const prefs = usePreferencesStore.getState()
  const chat = useChatStore.getState()
  const settings = threadId ? chat.settingsByThread[threadId] : undefined
  const targetProviderId =
    providerId ?? settings?.selectedProviderId ?? prefs.selectedProviderId
  if (!targetProviderId) return

  const base = resolveThreadProviderSelection(prefs, settings, targetProviderId)
  prefs.set(
    "modelSelectionByProvider",
    upsertProviderComposerSelection(
      prefs.modelSelectionByProvider,
      targetProviderId,
      patch
    )
  )
  if (threadId) {
    chat.setThreadSetting(
      threadId,
      "modelSelectionByProvider",
      upsertProviderComposerSelection(
        settings?.modelSelectionByProvider,
        targetProviderId,
        { ...base, ...patch }
      )
    )
  }
}

/** Keep the model used for dispatch and the model shown in each pane aligned. */
export function selectComposerModel(
  threadId: string | null,
  modelId: string,
  providerId?: string
): void {
  const next = modelId.trim()
  if (!next) return
  const prefs = usePreferencesStore.getState()
  const chat = useChatStore.getState()
  const settings = threadId ? chat.settingsByThread[threadId] : undefined
  const currentProviderId =
    settings?.selectedProviderId ?? prefs.selectedProviderId
  const targetProviderId = providerId ?? currentProviderId
  const currentModel =
    resolveThreadProviderSelection(prefs, settings, currentProviderId)
      ?.selectedModel ??
    settings?.selectedModel ??
    prefs.selectedModel

  recordModelSwitch({ threadId, fromModelId: currentModel, toModelId: next })
  updateProviderComposerSelection(threadId, targetProviderId, {
    selectedModel: next,
  })
  prefs.setMultiple({
    selectedModel: next,
    selectedProviderId: targetProviderId,
  })
  if (threadId) {
    chat.setThreadSetting(threadId, "selectedModel", next)
    chat.setThreadSetting(threadId, "selectedProviderId", targetProviderId)
  }
}
