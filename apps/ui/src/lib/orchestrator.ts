import {
  orchestratorModelKey,
  type OrchestratorModel,
  type OrchestratorSession,
} from "@betterc0de/schema"
import type { UiProvider } from "./provider-types"
import { useChatStore } from "./chat-store"

export interface TeamModelChoice {
  value: OrchestratorModel
  provider: UiProvider
  label: string
}
export function teamModelChoices(
  providers: readonly UiProvider[]
): TeamModelChoice[] {
  return providers.flatMap((provider) => {
    const kind = provider.providerKind
    const instance = provider.providerInstanceId
    if (
      (kind !== "claude" && kind !== "codex" && kind !== "grok_cli") ||
      !instance
    )
      return []
    return provider.models.map((model) => ({
      value: {
        providerKind: kind,
        providerInstanceId: instance,
        modelId: model.id,
      },
      provider,
      label: model.name,
    }))
  })
}
export const teamModelKey = orchestratorModelKey

export function restoreOrchestrationSelection(
  session: OrchestratorSession
): void {
  const store = useChatStore.getState()
  if (store.settingsByThread[session.threadId]?.orchestration !== undefined)
    return
  const providers =
    session.mode === "chat"
      ? session.allowedProviders
      : [...new Set(session.team.members.map((member) => member.providerKind))]
  store.setThreadSetting(
    session.threadId,
    "orchestration",
    session.status === "ready" && providers.length
      ? {
          enabled: true,
          providers,
          ...(session.selectedModels ? { models: session.selectedModels } : {}),
        }
      : { enabled: false }
  )
}

/** Adopt a backend-created thread; never create a second thread or overwrite its transcript. */
export function openOrchestratorChat(
  session: OrchestratorSession,
  providers: readonly UiProvider[],
  workerThreadId?: string
): void {
  const job = workerThreadId
    ? session.jobs.find((candidate) => candidate.threadId === workerThreadId)
    : undefined
  const member = job
    ? session.team.members.find((candidate) => candidate.id === job.memberId)
    : undefined
  if (workerThreadId && (!job || !member))
    throw new Error("This worker no longer belongs to the team.")
  const model = member ?? session.team.main
  const provider = providers.find(
    (candidate) =>
      candidate.providerKind === model.providerKind &&
      candidate.providerInstanceId === model.providerInstanceId
  )
  const providerId = provider?.id ?? model.providerInstanceId
  const id = workerThreadId ?? session.threadId
  useChatStore.setState((state) => ({
    threads: state.threads.some((thread) => thread.id === id)
      ? state.threads
      : [
          {
            id,
            title: member
              ? `[Agent] ${job?.name || member.name}`
              : "Orchestration",
            projectPath: session.projectPath,
            projectName:
              session.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ??
              "Project",
            parentThreadId: member ? session.threadId : null,
            messages: [],
            createdAt: job?.createdAt ?? session.createdAt,
            updatedAt: job?.createdAt ?? session.createdAt,
          },
          ...state.threads,
        ],
  }))
  const store = useChatStore.getState()
  if (!member) restoreOrchestrationSelection(session)
  else store.setThreadSetting(id, "orchestrationWorker", true)
  // Navigating back must not overwrite a model the user selected in the main chat.
  if (!member && store.settingsByThread[id]?.selectedModel) {
    store.setActiveThread(id)
    return
  }
  store.setThreadSetting(id, "selectedProviderId", providerId)
  store.setThreadSetting(id, "selectedModel", model.modelId)
  store.setThreadSetting(id, "modelSelectionByProvider", {
    [providerId]: {
      selectedModel: model.modelId,
      thinkingMode: null,
      fastMode: false,
      contextWindow: "1m",
      optionSelections: [],
    },
  })
  store.setThreadSetting(id, "chatMode", "agent")
  store.setThreadSetting(
    id,
    "permissionLevel",
    session.permissionLevel ?? "ask-on-edit"
  )
  store.setActiveThread(id)
}
