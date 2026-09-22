import { useEffect, useRef, useState } from "react"
import { CheckIcon, NetworkIcon } from "lucide-react"
import {
  ORCHESTRATOR_PROVIDER_LABELS,
  chatOrchestrationSchema,
  orchestrationForMain,
  orchestratorProviderSchema,
  type ChatOrchestration,
} from "@betterc0de/schema"
import {
  SimpleDropdownSub,
  SimpleDropdownSubItem,
  SimpleDropdownSeparator,
} from "@/components/ui/simple-dropdown"
import { ProviderIcon } from "@/components/provider-icon"
import { builtinProviders } from "@/lib/builtin-providers"
import {
  subagentModelChoices,
  selectedSubagentModels,
  orchestrationWithModels,
} from "@/lib/orchestration-models"
import { OrchestrationModelMenu } from "./orchestration-model-menu"
import { useChatStore } from "@/lib/chat-store"
import { useSettingsStore } from "@/lib/settings-store"
import {
  ORCHESTRATION_OFF,
  savedOrchestration,
  useOrchestrationDraft,
} from "@/lib/orchestration-composer-store"
import {
  getOrchestratorStatus,
  stopOrchestrator,
} from "@/services/backend/orchestratorApi"
import type { ComposerFooterProps } from "./chat-composer-types"

type Props = Pick<
  ComposerFooterProps,
  "threadId" | "providers" | "currentProvider" | "isStreaming"
>
const PROVIDERS = orchestratorProviderSchema.options.map((kind) => ({
  kind,
  label: ORCHESTRATOR_PROVIDER_LABELS[kind],
}))

function useSelection(
  threadId: Props["threadId"],
  mainProvider: Props["currentProvider"]
) {
  const saved = useChatStore((state) =>
    threadId ? state.settingsByThread[threadId]?.orchestration : undefined
  )
  const draft = useOrchestrationDraft((state) => state.selection)
  const experiment = useSettingsStore((state) => state.orchestratorEnabled)
  const selection = threadId ? savedOrchestration(saved) : draft
  return experiment
    ? orchestrationForMain(selection, mainProvider?.providerKind)
    : ORCHESTRATION_OFF
}

export function ComposerOrchestrationMenu({
  threadId,
  providers,
  currentProvider,
  isStreaming,
}: Props) {
  const selection = useSelection(threadId, currentProvider)
  const worker = useChatStore((state) =>
    Boolean(threadId && state.settingsByThread[threadId]?.orchestrationWorker)
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const mainKind = currentProvider?.providerKind
  const coordinator = selection.enabled ? selection.coordinator ?? "main" : "jev"
  const supported =
    mainKind === "claude" || mainKind === "codex" || mainKind === "grok_cli"
  const workers = PROVIDERS.filter(({ kind }) => coordinator === "jev" || kind !== mainKind)
  const choices = subagentModelChoices(providers, coordinator === "jev" ? undefined : mainKind)
  const selectedModels = selectedSubagentModels(selection, choices)
  const available = workers.filter(({ kind }) =>
    choices.some((choice) => choice.value.providerKind === kind)
  )
  const locked = busy || isStreaming || worker
  async function change(next: ChatOrchestration) {
    if (mutation.current || locked) return
    mutation.current = true
    setBusy(true)
    setError(null)
    try {
      if (next.enabled && next.models && next.models.length > 128)
        throw new Error("Select at most 128 subagent models.")
      next = chatOrchestrationSchema.parse(next)
      if (next.enabled && !useSettingsStore.getState().orchestratorEnabled)
        await useSettingsStore.getState().update({ orchestrator_enabled: true })
      if (!next.enabled && threadId) {
        const session = await getOrchestratorStatus(threadId)
        if (session?.status === "ready") await stopOrchestrator(threadId)
      }
      if (threadId)
        useChatStore
          .getState()
          .setThreadSetting(threadId, "orchestration", next)
      else useOrchestrationDraft.getState().set(next)
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not update orchestration."
        )
    } finally {
      mutation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const firstAvailable = available[0]
  return (
    <SimpleDropdownSub
      trigger={
        <>
          <NetworkIcon className="size-3.5" />
          <span className="flex-1">Orchestration</span>
          <span className="text-xs text-muted-foreground">
            {selection.enabled ? "On" : "Experimental"}
          </span>
        </>
      }
      className="w-72"
    >
      <SimpleDropdownSubItem
        keepOpen
        active={selection.enabled}
        aria-pressed={selection.enabled}
        disabled={
          locked || (!selection.enabled && (!supported || !firstAvailable))
        }
        onClick={() => {
          if (selection.enabled) void change({ enabled: false })
          else if (firstAvailable)
            void change(
              orchestrationWithModels(
                choices
                  .filter(
                    (choice) =>
                      choice.value.providerKind === firstAvailable.kind
                  )
                  .map((choice) => choice.value),
                coordinator
              )
            )
        }}
      >
        <NetworkIcon className="size-3.5" />
        <span className="flex-1">Enable orchestration</span>
        {selection.enabled && <CheckIcon className="size-3.5" />}
      </SimpleDropdownSubItem>
      <SimpleDropdownSeparator />
      {selection.enabled && (["jev", "main"] as const).map((value) => (
        <SimpleDropdownSubItem key={value} keepOpen active={coordinator === value} disabled={locked}
          onClick={() => void change(orchestrationWithModels(selectedModels.filter(model => value === "jev" || model.providerKind !== mainKind), value))}>
          <span className="flex-1">{value === "jev" ? "Jev coordinates" : "Chat model coordinates"}</span>
          {coordinator === value && <CheckIcon className="size-3.5" />}
        </SimpleDropdownSubItem>
      ))}
      {workers.map(({ kind }) => (
        <OrchestrationModelMenu
          key={kind}
          kind={kind}
          choices={choices.filter(
            (choice) => choice.value.providerKind === kind
          )}
          selected={selectedModels.filter(
            (model) => model.providerKind === kind
          )}
          disabled={locked || !supported}
          loading={providers.some(
            (provider) =>
              provider.providerKind === kind && provider.modelsReady === false
          )}
          onChange={(models) =>
            void change(
              orchestrationWithModels([
                ...selectedModels.filter(
                  (model) => model.providerKind !== kind
                ),
                ...models,
              ], coordinator)
            )
          }
        />
      ))}
      <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
        {worker
          ? "Workers cannot delegate further."
          : !supported
            ? "Choose Claude, Codex or Grok CLI as the main model."
            : isStreaming
              ? "Change the provider pool after this turn finishes."
              : coordinator === "jev" ? "Jev selects each phase and worker. Your chat model reports progress and results." : "The main model chooses agents from your selected models."}
      </p>
      {!available.length && supported && (
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Connect a worker provider in Settings first.
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </SimpleDropdownSub>
  )
}

export function ComposerOrchestrationBadge({
  threadId,
  currentProvider,
}: Pick<Props, "threadId" | "currentProvider">) {
  const selection = useSelection(threadId, currentProvider)
  if (!selection.enabled) return null
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-2 text-[11px] leading-4 text-muted-foreground"
      aria-label="Orchestration enabled"
    >
      <span>{selection.coordinator === "jev" ? "Jev orchestration" : "Orchestration"}</span>
      <ul
        aria-label="Agent providers"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l border-border/60 pl-3"
      >
        {selection.providers.map((kind) => {
          const provider = builtinProviders.find(
            (candidate) => candidate.providerKind === kind
          )
          return (
            <li
              key={kind}
              className="inline-flex items-center gap-1.5 text-foreground/80"
            >
              {provider && (
                <span
                  aria-hidden="true"
                  className="flex size-4 shrink-0 items-center justify-center"
                >
                  <ProviderIcon
                    provider={provider}
                    className={kind === "codex" ? "size-4" : "size-3.5"}
                  />
                </span>
              )}
              <span className="font-medium">
                {ORCHESTRATOR_PROVIDER_LABELS[kind]}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
