import {
  orchestratorModelKey,
  orchestratorReasoningDescriptor,
  modelThinkingOptions,
  normalizeThinkingModeValue,
  type ChatOrchestration,
  type OrchestratorModel,
  type OrchestratorSelectedModel,
  type ProviderOptionChoice,
} from "@betterc0de/schema"
import type { UiProvider } from "./provider-types"

export interface SubagentModelChoice {
  value: OrchestratorModel
  name: string
  provider: UiProvider
  reasoningOptions: readonly ProviderOptionChoice[]
}

/** Account-scoped native models from the current project's discovered catalog. */
export function subagentModelChoices(
  providers: readonly UiProvider[],
  mainProvider: string | undefined
): SubagentModelChoice[] {
  const seen = new Set<string>()
  return providers.flatMap((provider) => {
    const kind = provider.providerKind
    const instance = provider.providerInstanceId
    if (
      (kind !== "claude" && kind !== "codex" && kind !== "grok_cli") ||
      kind === mainProvider ||
      !instance ||
      provider.configured === false ||
      provider.availability === "unavailable" ||
      provider.modelsReady === false
    )
      return []
    return provider.models.flatMap((model) => {
      const value: OrchestratorModel = {
        providerKind: kind,
        providerInstanceId: instance,
        modelId: model.id,
      }
      const key = orchestratorModelKey(value)
      if (seen.has(key)) return []
      seen.add(key)
      const descriptor = orchestratorReasoningDescriptor(model.capabilities)
      const reasoningOptions = modelThinkingOptions({
        providerKind: kind,
        modelId: model.id,
        capabilities: model.capabilities,
      }).flatMap((option) => {
        if (option.mode === null) return []
        const normalizedMode = normalizeThinkingModeValue(option.mode)
        const advertised = descriptor?.options.find(
          (candidate) =>
            normalizeThinkingModeValue(candidate.id) === normalizedMode
        )
        return advertised ? [advertised] : []
      })
      return [{ value, name: model.name, provider, reasoningOptions }]
    })
  })
}

/** Materialize old provider-wide grants only when the user edits the selection. */
export function selectedSubagentModels(
  selection: ChatOrchestration,
  choices: readonly SubagentModelChoice[]
): OrchestratorSelectedModel[] {
  if (!selection.enabled) return []
  return (
    selection.models ??
    choices
      .filter((choice) =>
        selection.providers.includes(choice.value.providerKind)
      )
      .map((choice) => choice.value)
  )
}

export function orchestrationWithModels(
  models: readonly OrchestratorSelectedModel[]
): ChatOrchestration {
  const unique = [
    ...new Map(
      models.map((model) => [orchestratorModelKey(model), model])
    ).values(),
  ]
  return unique.length
    ? {
        enabled: true,
        providers: [...new Set(unique.map((model) => model.providerKind))],
        models: unique,
      }
    : { enabled: false }
}
