import {
  modelBooleanOption,
  modelThinkingOptions,
  normalizeThinkingModeValue,
  type ModelThinkingOption,
} from "@betterc0de/schema"
import type { ModelOption } from "@/types/remote"

export type ThinkingOption = ModelThinkingOption

export function thinkingOptionsFor(
  option: ModelOption | null
): ReadonlyArray<ThinkingOption> {
  return option ? modelThinkingOptions(option) : []
}

export function thinkingLabelFor(
  options: readonly ThinkingOption[],
  mode: string | null
): string {
  if (!mode) return "Off"
  const normalized = normalizeThinkingModeValue(mode)
  return (
    options.find(
      (option) =>
        option.mode !== null &&
        normalizeThinkingModeValue(option.mode) === normalized
    )?.label ?? mode
  )
}

export function supportsFastMode(option: ModelOption | null): boolean {
  return option !== null && modelBooleanOption(option, "fastMode")
}
