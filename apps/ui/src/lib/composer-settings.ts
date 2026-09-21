import type { PreferencesState } from "@/lib/preferences-store"
import type { ThreadSettings } from "@/lib/chat/types"
import {
  getProviderComposerSelection,
  upsertProviderComposerSelection,
  type ProviderComposerSelection,
} from "@/lib/provider-composer-selection"

export function resolveThreadProviderSelection(
  prefs: PreferencesState,
  settings: ThreadSettings | undefined,
  providerId: string
): ProviderComposerSelection | undefined {
  const legacy: ProviderComposerSelection = {}
  if (
    settings &&
    (settings.selectedProviderId ?? prefs.selectedProviderId) === providerId
  ) {
    if (settings.selectedModel !== undefined)
      legacy.selectedModel = settings.selectedModel
    if ("thinkingMode" in settings)
      legacy.thinkingMode = settings.thinkingMode ?? null
    if (settings.contextWindow !== undefined)
      legacy.contextWindow = settings.contextWindow
  }
  return getProviderComposerSelection(
    providerId,
    prefs.modelSelectionByProvider,
    { [providerId]: legacy },
    settings?.modelSelectionByProvider
  )
}

/** The same persisted selection is used by the composer and by dispatch. */
export function resolveComposerPreferences(
  prefs: PreferencesState,
  settings: ThreadSettings | undefined
) {
  const selectedProviderId =
    settings?.selectedProviderId ?? prefs.selectedProviderId
  const selection =
    resolveThreadProviderSelection(prefs, settings, selectedProviderId) ?? {}
  return {
    selectedProviderId,
    selectedModel:
      selection.selectedModel ?? settings?.selectedModel ?? prefs.selectedModel,
    thinkingMode:
      "thinkingMode" in selection
        ? (selection.thinkingMode ?? null)
        : settings && "thinkingMode" in settings
          ? (settings.thinkingMode ?? null)
          : prefs.thinkingMode,
    contextWindow: "1m" as const,
    fastMode: selection.fastMode ?? prefs.fastMode,
    chatMode: settings?.chatMode ?? prefs.chatMode,
    // Compatibility for old saved chats: retired Feature modes never affect sends.
    specialMode: null,
    permissionLevel:
      (settings?.permissionLevel as
        | PreferencesState["permissionLevel"]
        | undefined) ?? prefs.permissionLevel,
  }
}

/** Freeze defaults at creation/migration, before another chat updates them. */
export function snapshotComposerModelSettings(
  prefs: PreferencesState,
  settings?: ThreadSettings
): ThreadSettings {
  const selected = resolveComposerPreferences(prefs, settings)
  const selections = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(prefs.modelSelectionByProvider),
        ...Object.keys(settings?.modelSelectionByProvider ?? {}),
      ]),
    ].map((providerId) => [
      providerId,
      resolveThreadProviderSelection(prefs, settings, providerId) ?? {},
    ])
  )
  return {
    ...settings,
    selectedProviderId: selected.selectedProviderId,
    selectedModel: selected.selectedModel,
    modelSelectionByProvider: upsertProviderComposerSelection(
      selections,
      selected.selectedProviderId,
      {
        selectedModel: selected.selectedModel,
        thinkingMode: selected.thinkingMode,
        contextWindow: selected.contextWindow,
        fastMode: selected.fastMode,
        optionSelections:
          selections[selected.selectedProviderId]?.optionSelections ?? [],
      }
    ),
  }
}
