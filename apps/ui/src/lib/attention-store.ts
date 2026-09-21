import { create } from "zustand"

import { useChatStore } from "@/lib/chat-store"
import { deriveThreadAttention, type ThreadAttention } from "@/lib/pending-attention"

/**
 * App-wide pending-attention state: which threads are waiting on the user
 * (tool approvals, questions, plan reviews). Fed by a single chat-store
 * watcher; consumed by pane-tab / sidebar badges.
 */

interface AttentionState {
  byThread: Record<string, ThreadAttention>
  total: number
  setThread: (attention: ThreadAttention) => void
  removeThread: (threadId: string) => void
}

export const useAttentionStore = create<AttentionState>((set, get) => ({
  byThread: {},
  total: 0,

  setThread: (attention) => {
    const current = get().byThread[attention.threadId]
    if (
      current &&
      current.total === attention.total &&
      current.approvals === attention.approvals &&
      current.questions === attention.questions &&
      current.planApprovals === attention.planApprovals &&
      current.openRequestKeys.length === attention.openRequestKeys.length &&
      current.openRequestKeys.every(
        (key, index) => key === attention.openRequestKeys[index]
      )
    ) {
      return
    }
    set((state) => {
      const byThread = { ...state.byThread }
      if (attention.total === 0) {
        if (!(attention.threadId in byThread)) return state
        delete byThread[attention.threadId]
      } else {
        byThread[attention.threadId] = attention
      }
      const total = Object.values(byThread).reduce(
        (sum, item) => sum + item.total,
        0
      )
      return { byThread, total }
    })
  },

  removeThread: (threadId) => {
    set((state) => {
      if (!(threadId in state.byThread)) return state
      const byThread = { ...state.byThread }
      delete byThread[threadId]
      const total = Object.values(byThread).reduce(
        (sum, item) => sum + item.total,
        0
      )
      return { byThread, total }
    })
  },
}))

export function useThreadAttention(
  threadId: string | null
): ThreadAttention | null {
  return useAttentionStore((state) =>
    threadId ? (state.byThread[threadId] ?? null) : null
  )
}

let watcherActive = false

/**
 * Subscribe once to the chat store and keep the attention store in sync.
 * Reference-bails on unrelated updates (streaming deltas mutate
 * `streamingByThread`, not `activitiesByThread`). Returns an unsubscribe.
 */
export function initAttentionWatcher(): () => void {
  if (watcherActive) return () => {}
  watcherActive = true

  let previousActivities = useChatStore.getState().activitiesByThread

  // Seed current state (app start / remount).
  for (const [threadId, activities] of Object.entries(previousActivities)) {
    useAttentionStore
      .getState()
      .setThread(deriveThreadAttention(threadId, activities))
  }

  const unsubscribe = useChatStore.subscribe((state) => {
    const nextActivities = state.activitiesByThread
    if (nextActivities === previousActivities) return
    const prevActivities = previousActivities
    previousActivities = nextActivities

    for (const [threadId, activities] of Object.entries(nextActivities)) {
      if (prevActivities[threadId] === activities) continue
      useAttentionStore
        .getState()
        .setThread(deriveThreadAttention(threadId, activities))
    }

    for (const threadId of Object.keys(prevActivities)) {
      if (threadId in nextActivities) continue
      useAttentionStore.getState().removeThread(threadId)
    }
  })

  return () => {
    watcherActive = false
    unsubscribe()
  }
}
