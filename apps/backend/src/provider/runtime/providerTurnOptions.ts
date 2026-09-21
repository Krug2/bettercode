import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  type ProviderSendTurnInput,
} from "./contracts"
import { normalizeModelSlug } from "@betterc0de/schema"

export function resolveTurnModelId(input: ProviderSendTurnInput): string {
  const rawModel = input.modelSelection?.model ?? input.modelId
  const providerHint =
    input.modelSelection?.instanceId ?? input.providerInstanceId ?? undefined
  return normalizeModelSlug(rawModel, providerHint) ?? rawModel
}

export function resolveTurnStringOption(
  input: ProviderSendTurnInput,
  optionId: string | ReadonlyArray<string>,
  legacyValue?: string | null
): string | null | undefined {
  for (const id of asOptionIds(optionId)) {
    const value = getModelSelectionStringOptionValue(input.modelSelection, id)
    if (value !== undefined) return value
  }
  return legacyValue
}

export function resolveTurnBooleanOption(
  input: ProviderSendTurnInput,
  optionId: string | ReadonlyArray<string>,
  legacyValue?: boolean | null
): boolean | null | undefined {
  for (const id of asOptionIds(optionId)) {
    const value = getModelSelectionBooleanOptionValue(input.modelSelection, id)
    if (value !== undefined) return value
  }
  return legacyValue
}

function asOptionIds(
  optionId: string | ReadonlyArray<string>
): ReadonlyArray<string> {
  return typeof optionId === "string" ? [optionId] : optionId
}
