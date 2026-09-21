import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "@betterc0de/schema/model-selection"
import type { ModelSelection } from "@betterc0de/schema"
import type { UiProvider } from "@/lib/provider-types"

type CompacterProviderInput = Pick<
  UiProvider,
  "id" | "providerKind" | "providerInstanceId"
>

export function buildNativeThreadCompacterSelection(input: {
  provider?: CompacterProviderInput | null
  providers?: readonly CompacterProviderInput[]
  selectedModel?: string | null
  thinkingMode?: string | null
}): ModelSelection | null {
  const model = input.selectedModel?.trim()
  if (!model) return null

  const providerKind = nativeCompacterProviderKind(input.provider)
  const provider =
    providerKind === "claude-terminal"
      ? (findDirectNativeCompacterProvider(input.providers, "claude") ??
        input.provider)
      : input.provider

  const instanceId = (provider?.providerInstanceId ?? provider?.id ?? "").trim()
  if (!instanceId && providerKind !== "claude-terminal") return null

  const family = nativeCompacterFamily(provider)
  if (!family) {
    if (providerKind !== "claude-terminal") return null
    return buildClaudeTerminalHandoffCompacterSelection({
      provider: input.provider,
      selectedModel: model,
      thinkingMode: input.thinkingMode,
    })
  }
  const nativeModel = normalizeNativeCompacterModel(family, model)

  const effort = normalizeNativeCompacterEffort(family, input.thinkingMode)
  const options: ModelSelection["options"] =
    effort && family === "codex"
      ? [{ id: "reasoningEffort", value: effort }]
      : effort
        ? [
            { id: "effort", value: effort },
            { id: "reasoningEffort", value: effort },
          ]
        : undefined

  return {
    instanceId,
    model: nativeModel,
    ...(options ? { options } : {}),
  }
}

function buildClaudeTerminalHandoffCompacterSelection(input: {
  provider?: CompacterProviderInput | null
  selectedModel: string
  thinkingMode?: string | null
}): ModelSelection | null {
  const instanceId = (
    input.provider?.providerInstanceId ??
    input.provider?.id ??
    "claude-terminal"
  ).trim()
  if (!instanceId) return null
  const effort = normalizeNativeCompacterEffort("claude", input.thinkingMode)
  return {
    instanceId,
    model: input.selectedModel,
    ...(effort
      ? {
          options: [
            { id: "effort", value: effort },
            { id: "reasoningEffort", value: effort },
          ],
        }
      : {}),
  }
}

function findDirectNativeCompacterProvider(
  providers: readonly CompacterProviderInput[] | undefined,
  family: "codex" | "claude"
): CompacterProviderInput | null {
  return (
    providers?.find((provider) => {
      if (providerKindUnavailable(provider)) return false
      return nativeCompacterProviderKind(provider) === family
    }) ?? null
  )
}

function nativeCompacterFamily(
  provider?: CompacterProviderInput | null
): "codex" | "claude" | null {
  const kind = nativeCompacterProviderKind(provider)
  if (kind === "claude-terminal") return null
  return kind
}

function nativeCompacterProviderKind(
  provider?: CompacterProviderInput | null
): "codex" | "claude" | "claude-terminal" | null {
  const kind = compactProviderKey(provider?.providerKind)
  const id = compactProviderKey(provider?.providerInstanceId ?? provider?.id)
  if (
    kind.includes("claudeterminal") ||
    kind.includes("claudepty") ||
    id.includes("claudeterminal") ||
    id.includes("claudepty") ||
    id.includes("ptywrapper")
  ) {
    return "claude-terminal"
  }
  if (isNativeCodexProviderKey(kind) || isNativeCodexProviderKey(id)) {
    return "codex"
  }
  if (isNativeClaudeProviderKey(kind) || isNativeClaudeProviderKey(id)) {
    return "claude"
  }
  return null
}

function providerKindUnavailable(provider: CompacterProviderInput): boolean {
  const configured = (provider as { configured?: boolean }).configured
  return configured === false
}

function isNativeCodexProviderKey(key: string): boolean {
  return key === "codex" || key === "codexcli"
}

function isNativeClaudeProviderKey(key: string): boolean {
  return (
    key === "claude" ||
    key === "claudecli" ||
    key === "claudeagent" ||
    key === "anthropiccli"
  )
}

function normalizeNativeCompacterEffort(
  family: "codex" | "claude",
  value?: string | null
): string | null {
  const key = compactProviderKey(value)
  if (!key || key === "off" || key === "none") return null
  if (key === "low" || key === "medium" || key === "high") return key
  if (
    key === "xhigh" ||
    key === "extrahigh" ||
    key === "max" ||
    key === "ultra" ||
    key === "ultrathink" ||
    key === "maxultrathink"
  ) {
    return family === "codex" ? "xhigh" : "max"
  }
  return null
}

function normalizeNativeCompacterModel(
  family: "codex" | "claude",
  model: string
): string {
  const trimmed = model.trim()
  if (
    !trimmed ||
    looksClearlyIncompatibleWithNativeCompacter(family, trimmed)
  ) {
    return (
      DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[family] ??
      DEFAULT_GIT_TEXT_GENERATION_MODEL
    )
  }
  return trimmed
}

function looksClearlyIncompatibleWithNativeCompacter(
  family: "codex" | "claude",
  model: string
): boolean {
  const key = model.trim().toLowerCase()
  if (family === "claude") {
    return (
      key === "auto" ||
      key.startsWith("gpt-") ||
      /^o[1345][\w.-]*/.test(key) ||
      key.startsWith("openai/") ||
      key.startsWith("composer-")
    )
  }
  return (
    key === "auto" ||
    key.includes("/") ||
    key.startsWith("claude-") ||
    key.startsWith("anthropic/") ||
    key.startsWith("opus") ||
    key.startsWith("sonnet") ||
    key.startsWith("haiku") ||
    key.startsWith("composer-")
  )
}

function compactProviderKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
}
