import { useCallback } from "react"
import { useChatStore } from "../chat-store"
import { emptyStreamState, type ThreadStreamState } from "./types"
import type { ChatMessage, ThreadActivity } from "@betterc0de/schema"

const emptyMessages: ChatMessage[] = []
const emptyActivities: ThreadActivity[] = []

/** Get a thread's streaming state (returns empty defaults for unknown threads) */
export function getThreadStream(
  state: { streamingByThread: Record<string, ThreadStreamState> },
  threadId: string | null,
): ThreadStreamState {
  if (!threadId) return emptyStreamState
  return state.streamingByThread[threadId] ?? emptyStreamState
}

/** Hook selector for the currently-active thread, or null. */
export function useActiveThread() {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  return useThreadById(activeThreadId)
}

/** Same as `useActiveThread()` but for an arbitrary threadId — used by
 *  split-mode chat columns that each render their own thread independent of
 *  the globally-active one. */
export function useThreadById(threadId: string | null | undefined) {
  const selectThread = useCallback(
    (s: ReturnType<typeof useChatStore.getState>) =>
      threadId ? (s.threads.find((t) => t.id === threadId) ?? null) : null,
    [threadId],
  )
  return useChatStore(selectThread)
}

export function useThreadMessages(threadId: string | null | undefined) {
  const selectMessages = useCallback(
    (s: ReturnType<typeof useChatStore.getState>) =>
      threadId
        ? (s.threads.find((t) => t.id === threadId)?.messages ?? emptyMessages)
        : emptyMessages,
    [threadId],
  )
  return useChatStore(selectMessages)
}

export function useThreadActivities(threadId: string | null | undefined) {
  const selectActivities = useCallback(
    (s: ReturnType<typeof useChatStore.getState>) =>
      threadId
        ? (s.activitiesByThread[threadId] ?? emptyActivities)
        : emptyActivities,
    [threadId],
  )
  return useChatStore(selectActivities)
}

export function useActiveMessages() {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  return useThreadMessages(activeThreadId)
}
