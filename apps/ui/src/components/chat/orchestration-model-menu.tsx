import { BrainIcon, CheckIcon } from "lucide-react"
import {
  ORCHESTRATOR_PROVIDER_LABELS,
  orchestratorModelKey,
  type OrchestratorSelectedModel,
  type OrchestratorProvider,
} from "@betterc0de/schema"
import {
  SimpleDropdownSub,
  SimpleDropdownSubItem,
  SimpleDropdownSeparator,
} from "@/components/ui/simple-dropdown"
import { ProviderIcon } from "@/components/provider-icon"
import { builtinProviders } from "@/lib/builtin-providers"
import type { SubagentModelChoice } from "@/lib/orchestration-models"

interface Props {
  kind: OrchestratorProvider
  choices: readonly SubagentModelChoice[]
  selected: readonly OrchestratorSelectedModel[]
  disabled: boolean
  loading: boolean
  onChange: (models: OrchestratorSelectedModel[]) => void
}

export function OrchestrationModelMenu({
  kind,
  choices,
  selected,
  disabled,
  loading,
  onChange,
}: Props) {
  const label = ORCHESTRATOR_PROVIDER_LABELS[kind]
  const provider = builtinProviders.find(
    (candidate) => candidate.providerKind === kind
  )
  const selectedKeys = new Set(selected.map(orchestratorModelKey))
  const selectedByKey = new Map(
    selected.map((model) => [orchestratorModelKey(model), model])
  )
  const availableKeys = new Set(
    choices.map((choice) => orchestratorModelKey(choice.value))
  )
  const missing = loading
    ? []
    : selected.filter(
        (model) => !availableKeys.has(orchestratorModelKey(model))
      )
  const allSelected =
    choices.length > 0 &&
    choices.every((choice) =>
      selectedKeys.has(orchestratorModelKey(choice.value))
    )
  const multipleAccounts =
    new Set([
      ...choices.map((choice) => choice.value.providerInstanceId),
      ...selected.map((model) => model.providerInstanceId),
    ]).size > 1
  function toggle(model: OrchestratorSelectedModel) {
    const key = orchestratorModelKey(model)
    onChange(
      selectedKeys.has(key)
        ? selected.filter((item) => orchestratorModelKey(item) !== key)
        : [...selected, model]
    )
  }
  return (
    <SimpleDropdownSub
      trigger={
        <>
          {provider && (
            <span aria-hidden="true">
              <ProviderIcon provider={provider} className="size-3.5" />
            </span>
          )}
          <span className="flex-1">{label}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {selected.length ? `${selected.length} selected` : "Off"}
          </span>
        </>
      }
      className="w-72"
    >
      <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
        {label} subagent models
      </div>
      {choices.length > 0 && (
        <>
          <SimpleDropdownSubItem
            keepOpen
            active={allSelected}
            aria-pressed={allSelected}
            disabled={disabled || loading}
            onClick={() =>
              onChange(
                allSelected
                  ? []
                  : choices.map(
                      (choice) =>
                        selectedByKey.get(orchestratorModelKey(choice.value)) ??
                        choice.value
                    )
              )
            }
          >
            <span className="flex-1">All models</span>
            {allSelected && <CheckIcon className="size-3.5" />}
          </SimpleDropdownSubItem>
          <SimpleDropdownSeparator />
        </>
      )}
      {choices.map((choice) => {
        const key = orchestratorModelKey(choice.value)
        const checked = selectedKeys.has(key)
        const selectedModel = selectedByKey.get(key)
        const effort = selectedModel?.reasoningEffort ?? ""
        const unsupported =
          effort !== "" &&
          !choice.reasoningOptions.some((option) => option.id === effort)
        return (
          <div key={key}>
            <SimpleDropdownSubItem
              keepOpen
              active={checked}
              aria-pressed={checked}
              disabled={disabled}
              onClick={() => toggle(choice.value)}
            >
              <span className="min-w-0 flex-1 py-0.5">
                <span className="block truncate">{choice.name}</span>
                {multipleAccounts && (
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {choice.provider.name}
                  </span>
                )}
              </span>
              {checked && <CheckIcon className="size-3.5 shrink-0" />}
            </SimpleDropdownSubItem>
            {selectedModel && (
              <label className="mx-2 mt-1 mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <BrainIcon aria-hidden="true" className="size-3 shrink-0" />
                <span>Thinking</span>
                <select
                  aria-label={`${choice.name} thinking${multipleAccounts ? ` (${choice.provider.name})` : ""}`}
                  title="Auto uses the provider's default thinking level."
                  value={effort}
                  disabled={disabled || loading}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-popover px-2 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  onChange={(event) => {
                    const reasoningEffort = event.currentTarget.value || null
                    onChange(
                      selected.map((model) =>
                        orchestratorModelKey(model) === key
                          ? { ...model, reasoningEffort }
                          : model
                      )
                    )
                  }}
                >
                  <option value="">Auto</option>
                  {choice.reasoningOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                  {unsupported && (
                    <option value={effort} disabled>
                      {effort} (unavailable)
                    </option>
                  )}
                </select>
              </label>
            )}
          </div>
        )
      })}
      {missing.map((model) => (
        <SimpleDropdownSubItem
          key={orchestratorModelKey(model)}
          keepOpen
          aria-pressed={true}
          disabled={disabled}
          onClick={() => toggle(model)}
        >
          <span className="min-w-0 flex-1 py-0.5">
            <span className="block truncate">{model.modelId}</span>
            {multipleAccounts && (
              <span className="block truncate text-[10px] text-muted-foreground">
                {model.providerInstanceId}
              </span>
            )}
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              Unavailable · remove selection
            </span>
          </span>
          <CheckIcon className="size-3.5 shrink-0" />
        </SimpleDropdownSubItem>
      ))}
      {(loading || !choices.length) && (
        <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          {loading
            ? "Loading supported models…"
            : `No supported models available. Connect ${label} in Settings.`}
        </p>
      )}
    </SimpleDropdownSub>
  )
}
