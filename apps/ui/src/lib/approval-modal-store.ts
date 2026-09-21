import { create } from "zustand"

/**
 * Focused-approval modal state. `use-approval-attention` opens the modal for
 * the newest unresolved request when its thread is in the foreground; a
 * dismissed request never re-opens (the inline row remains).
 */

export interface ApprovalModalTarget {
  threadId: string
  requestId: string
  kind: "tool_approval" | "plan_approval"
}

interface ApprovalModalState {
  target: ApprovalModalTarget | null
  /**
   * The full plan dialog is open. Both are `z-50` Radix portals, so stacking
   * them paints two backdrops — hold this modal back until the plan dialog
   * closes. A latch, not a dismissal: `use-approval-attention` re-opens.
   */
  planModalOpen: boolean
  dismissedRequestIds: ReadonlySet<string>
  setPlanModalOpen: (open: boolean) => void
  open: (target: ApprovalModalTarget) => void
  /** Close without deciding — never auto-reopen this request. */
  dismiss: () => void
  /** Close because the request was decided/resolved elsewhere. */
  close: () => void
}

export const useApprovalModalStore = create<ApprovalModalState>((set, get) => ({
  target: null,
  planModalOpen: false,
  dismissedRequestIds: new Set<string>(),

  setPlanModalOpen: (open) => {
    if (get().planModalOpen === open) return
    // Clearing `target` yields the surface WITHOUT marking the request
    // dismissed, so it comes back once the plan dialog closes.
    set(open ? { planModalOpen: true, target: null } : { planModalOpen: false })
  },

  open: (target) => {
    const { target: current, dismissedRequestIds, planModalOpen } = get()
    if (planModalOpen) return
    if (dismissedRequestIds.has(target.requestId)) return
    if (current?.requestId === target.requestId) return
    set({ target })
  },

  dismiss: () => {
    const current = get().target
    if (!current) return
    const dismissed = new Set(get().dismissedRequestIds)
    dismissed.add(current.requestId)
    set({ target: null, dismissedRequestIds: dismissed })
  },

  close: () => {
    if (get().target === null) return
    set({ target: null })
  },
}))
