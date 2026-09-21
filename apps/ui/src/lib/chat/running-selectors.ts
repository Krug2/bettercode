import { useCallback, useEffect, useState } from "react"
import { useChatStore } from "../chat-store"

/**
 * Per-thread "is this chat working, and for how long" state.
 *
 * The store tracks streaming per thread but nothing recorded *when* a run
 * started, so no surface could say how long a chat had been working — the one
 * thing you want to know while waiting on it.
 */

type ChatState = ReturnType<typeof useChatStore.getState>

/**
 * Run start times live outside the store so recording them does not have to be
 * threaded through the eleven places that set `isStreaming`. Module scoped, so
 * a card that scrolls out of view and back keeps its elapsed time instead of
 * restarting from zero.
 */
const startedAtByThread = new Map<string, number>()

function noteRunning(threadId: string, running: boolean): void {
  if (!running) {
    startedAtByThread.delete(threadId)
    return
  }
  if (!startedAtByThread.has(threadId)) {
    startedAtByThread.set(threadId, Date.now())
  }
}

/**
 * A thread counts as running when the local stream says so *or* when the
 * backend session still holds an active turn. The second case is what keeps a
 * turn visible after a reconnect, or when it was started from the mobile app.
 */
export function useThreadIsRunning(threadId: string | null | undefined): boolean {
  const select = useCallback(
    (state: ChatState) => {
      if (!threadId) return false
      if (state.streamingByThread[threadId]?.isStreaming) return true
      const thread = state.threads.find((item) => item.id === threadId)
      return Boolean(thread?.session?.activeTurnId)
    },
    [threadId]
  )
  return useChatStore(select)
}

export function formatRunningElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * How long this chat has been working, updated every second, or null when it
 * is idle. Only running threads hold a timer, so an idle list does not
 * re-render once a second.
 */
export function useThreadRunningElapsed(
  threadId: string | null | undefined
): string | null {
  const isRunning = useThreadIsRunning(threadId)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!threadId) return
    noteRunning(threadId, isRunning)
    if (!isRunning) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [threadId, isRunning])

  if (!isRunning || !threadId) return null
  const startedAt = startedAtByThread.get(threadId)
  // Null for the single frame between the run starting and the effect
  // recording it; the caller renders its label without a duration.
  return startedAt === undefined ? null : formatRunningElapsed(startedAt, now)
}
