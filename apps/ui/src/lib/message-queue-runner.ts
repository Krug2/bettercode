import type { QueuedMessage, createMessageQueueStore } from "./message-queue-store"

type QueueStore = ReturnType<typeof createMessageQueueStore>
export function startMessageQueueRunner({ queue, isReady, send, subscribeReady, onError }: {
  queue: QueueStore
  isReady(threadId: string): boolean
  send(message: QueuedMessage): Promise<unknown>
  subscribeReady(wake: () => void): () => void
  onError(error: unknown): void
}) {
  let stopped = false
  let scheduled = false
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const retryCounts = new Map<string, number>()
  const active = new Set<string>()
  const wake = () => {
    if (stopped || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (stopped) return
      const heads = new Map<string, QueuedMessage>()
      for (const entry of queue.getState().messages) if (!heads.has(entry.threadId)) heads.set(entry.threadId, entry)
      for (const entry of heads.values()) {
        if (entry.status !== "queued" || active.has(entry.threadId) || retryTimers.has(entry.threadId) || !isReady(entry.threadId)) continue
        active.add(entry.threadId)
        void (async () => {
          try {
            const claimed = queue.getState().claim(entry.id)
            if (!claimed) return
            const result = await send(claimed)
            if (result === false) {
              if (queue.getState().messages.find(message => message.id === entry.id)?.pauseRequested) {
                queue.getState().release(entry.id)
                return
              }
              // A definitive busy/preparation response is safe to retry. A
              // rejected/ambiguous dispatch goes to fail(), never this branch.
              const attempts = (retryCounts.get(entry.id) ?? 0) + 1
              retryCounts.set(entry.id, attempts)
              if (attempts >= 3) {
                queue.getState().fail(entry.id, "The chat is still busy. Resume the queue when it is ready.")
              } else {
                retryTimers.set(entry.threadId, setTimeout(() => {
                  retryTimers.delete(entry.threadId)
                  wake()
                }, 1000))
                queue.getState().release(entry.id)
              }
            } else {
              retryCounts.delete(entry.id)
              queue.getState().finish(entry.id)
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : "Message could not be sent."
            try { queue.getState().fail(entry.id, `Delivery could not be confirmed. Check the chat before resuming. ${reason}`) }
            catch (storageError) { onError(storageError) }
            onError(error)
          } finally {
            active.delete(entry.threadId)
            wake()
          }
        })()
      }
    })
  }
  const unsubscribeQueue = queue.subscribe((state, previous) => {
    for (const entry of state.messages) {
      const before = previous.messages.find(message => message.id === entry.id)
      if (entry.status === "queued" && (before?.status === "paused" || before?.status === "failed")) retryCounts.delete(entry.id)
    }
    wake()
  })
  const unsubscribeReady = subscribeReady(wake)
  wake()
  return () => {
    stopped = true
    unsubscribeQueue()
    unsubscribeReady()
    for (const timer of retryTimers.values()) clearTimeout(timer)
  }
}
