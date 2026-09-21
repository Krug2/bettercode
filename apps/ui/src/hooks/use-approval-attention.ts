import { useEffect } from "react"

import { useApprovalModalStore } from "@/lib/approval-modal-store"
import { useAttentionStore } from "@/lib/attention-store"
import { useChatStore } from "@/lib/chat-store"

/**
 * Focus side of the "Modal + Inline" approval UX: when the ACTIVE thread has
 * a pending tool/plan approval and the window is visible, open the approval
 * modal for the newest request. Unfocused threads only get badges + toasts
 * (attention watcher) — the modal never steals across threads.
 */
export function useApprovalAttention() {
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const attention = useAttentionStore((state) =>
    activeThreadId ? (state.byThread[activeThreadId] ?? null) : null
  )
  const planModalOpen = useApprovalModalStore((state) => state.planModalOpen)

  useEffect(() => {
    if (!activeThreadId || !attention) return
    // Never stack on the full plan dialog. Closing it re-runs this effect, so
    // a still-open request opens then.
    if (planModalOpen) return
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return
    }
    // Newest request wins; plan approvals take precedence over tool
    // approvals (the turn is blocked on the plan decision).
    const keys = attention.openRequestKeys
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!
      if (key.startsWith("plan:")) {
        const requestId = key.slice("plan:".length)
        // Legacy captured-plan keys ("<threadId>::<planId>") are advisory —
        // only interactive plan_approval REQUESTS open the modal.
        if (requestId.includes("::")) continue
        useApprovalModalStore.getState().open({
          threadId: activeThreadId,
          requestId,
          kind: "plan_approval",
        })
        return
      }
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!
      if (key.startsWith("approval:")) {
        useApprovalModalStore.getState().open({
          threadId: activeThreadId,
          requestId: key.slice("approval:".length),
          kind: "tool_approval",
        })
        return
      }
    }
  }, [activeThreadId, attention, planModalOpen])
}
