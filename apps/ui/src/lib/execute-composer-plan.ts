import { useChatStore } from "@/lib/chat-store"
import { usePreferencesStore } from "@/lib/preferences-store"
import { resolveComposerPreferences, snapshotComposerModelSettings } from "@/lib/composer-settings"
import { resolveNewThreadContext } from "@/lib/thread-context"
import { unwrapPlanContent } from "@/lib/plan-content"
import { buildPlanImplementationPrompt, buildPlanImplementationThreadTitle } from "@/lib/proposed-plan"
import { implementPendingPlanApproval } from "@/lib/plan-implement"
import type { SourceProposedPlanReference } from "@/lib/plan-modal"
import type { ChatSubmitPayload } from "@/lib/slash-command-runtime"

/** Use the normal submit lane, with the plan owner's identity fixed at open time. */
export async function executeComposerPlan({ threadId, content, sourceProposedPlan, inNewThread, submit }: {
  threadId: string | null
  content: string
  sourceProposedPlan: SourceProposedPlanReference | null
  inNewThread: boolean
  submit: (payload: ChatSubmitPayload) => unknown
}): Promise<void> {
  const store = useChatStore.getState()
  const ownerId = sourceProposedPlan?.threadId ?? threadId
  const owner = store.threads.find(thread => thread.id === ownerId)
  if (!owner) return
  const plan = unwrapPlanContent(content)
  let targetId = owner.id
  if (inNewThread) {
    const context = resolveNewThreadContext({ activeThread: owner })
    targetId = store.createThread(buildPlanImplementationThreadTitle(plan), context.projectName, context.projectPath, context.options)
    const prefs = usePreferencesStore.getState()
    const settings = store.settingsByThread[owner.id]
    const inherited = snapshotComposerModelSettings(prefs, settings)
    useChatStore.setState(state => ({ settingsByThread: {
      ...state.settingsByThread,
      [targetId]: { ...resolveComposerPreferences(prefs, settings), modelSelectionByProvider: inherited.modelSelectionByProvider },
    } }))
  }
  store.setThreadSetting(targetId, "chatMode", "agent")
  if (!inNewThread) {
    const outcome = await implementPendingPlanApproval(targetId, { permissionMode: "acceptEdits" })
    if (outcome !== "no-approval") return
  }
  await submit({
    threadId: targetId,
    text: buildPlanImplementationPrompt(plan),
    visibleText: "Implement the proposed plan.",
    chatModeOverride: "agent",
    sourceProposedPlan,
    files: [],
  })
}
