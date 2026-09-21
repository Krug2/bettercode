import { create } from "zustand"
import type { BrowserElementReference } from "@betterc0de/schema"
import type { ChatSubmitPayload } from "@/lib/slash-command-runtime"

export type QueuedMessagePayload = Omit<ChatSubmitPayload, "threadId" | "queuedSubmission"> & {
  browserElements: BrowserElementReference[]
}
export interface QueuedMessage {
  id: string
  threadId: string
  createdAt: string
  payload: QueuedMessagePayload
  status: "queued" | "sending" | "paused" | "failed"
  pauseRequested?: boolean
  error?: string
}
export interface QueueStorage {
  read(): string | null
  write(value: string): void
}
const key = "betterc0de-message-queue"
const browserStorage: QueueStorage = {
  read: () => typeof localStorage === "undefined" ? null : localStorage.getItem(key),
  write: (value) => { if (typeof localStorage !== "undefined") localStorage.setItem(key, value) },
}

interface MessageQueueState {
  messages: QueuedMessage[]
  enqueue(threadId: string, payload: QueuedMessagePayload): QueuedMessage
  claim(id: string): QueuedMessage | null
  finish(id: string): void
  release(id: string): void
  fail(id: string, error: string): void
  pause(threadId: string, reason?: string): void
  resume(threadId: string): void
  remove(id: string): void
  discardThread(threadId: string): void
}

function restore(storage: QueueStorage): QueuedMessage[] {
  try {
    const values: unknown = JSON.parse(storage.read() ?? "[]")
    if (!Array.isArray(values)) return []
    return values.filter((value): value is QueuedMessage => Boolean(
      value && typeof value.id === "string" && typeof value.threadId === "string" &&
      typeof value.createdAt === "string" && typeof value.payload?.text === "string" &&
      Array.isArray(value.payload.files) && Array.isArray(value.payload.browserElements)
    )).map((value) => ({
      ...value,
      status: "paused",
      error: value.status === "sending"
        ? "Delivery was interrupted. Check the chat before resuming."
        : "Restored after restart. Resume when ready.",
    }))
  } catch { return [] }
}

/** Unsubmitted drafts, like browser selections, live in the renderer's local
 * storage. Provider messages still use the existing durable dispatch lane. */
export function createMessageQueueStore(storage: QueueStorage = browserStorage) {
  return create<MessageQueueState>((set, get) => {
    const commit = (messages: QueuedMessage[]) => {
      // Persist before acknowledging enqueue or starting delivery. A quota
      // failure leaves the composer draft and the previous queue untouched.
      storage.write(JSON.stringify(messages))
      set({ messages })
    }
    const change = (id: string, patch: Partial<QueuedMessage>) =>
      commit(get().messages.map(message => message.id === id ? { ...message, ...patch } : message))
    return {
      messages: restore(storage),
      enqueue(threadId, payload) {
        if (get().messages.filter(message => message.threadId === threadId).length >= 30)
          throw new Error("This chat already has 30 queued messages.")
        const message: QueuedMessage = {
          id: crypto.randomUUID(), threadId, createdAt: new Date().toISOString(),
          payload: structuredClone(payload), status: "queued",
        }
        commit([...get().messages, message])
        return message
      },
      claim(id) {
        const message = get().messages.find(entry => entry.id === id)
        if (!message || message.status !== "queued" ||
          get().messages.find(entry => entry.threadId === message.threadId)?.id !== id) return null
        change(id, { status: "sending", error: undefined, pauseRequested: false })
        return message
      },
      finish: id => commit(get().messages.filter(message => message.id !== id)),
      release(id) {
        const entry = get().messages.find(message => message.id === id)
        if (entry) change(id, entry.pauseRequested ? { status: "paused", error: "Queue paused." } : { status: "queued" })
      },
      fail(id, error) {
        const entry = get().messages.find(message => message.id === id)
        if (!entry) return
        const messages = get().messages.map(message => message.threadId !== entry.threadId ? message : {
          ...message, status: message.id === id ? "failed" as const : "paused" as const,
          error: message.id === id ? error : undefined,
        })
        try { commit(messages) } catch (storageError) { set({ messages }); throw storageError }
      },
      pause(threadId, reason = "Queue paused.") {
        if (!get().messages.some(message => message.threadId === threadId && (message.status === "queued" || message.status === "sending"))) return
        const messages = get().messages.map(message => message.threadId === threadId && (message.status === "queued" || message.status === "sending")
          ? { ...message, status: message.status === "sending" ? "sending" as const : "paused" as const, pauseRequested: true, error: reason } : message)
        try { commit(messages) } catch (error) {
          // Stop must still prevent automatic delivery if browser storage is full.
          // Restored drafts are paused on startup regardless of saved status.
          set({ messages })
          throw error
        }
      },
      resume(threadId) {
        commit(get().messages.map(message => message.threadId === threadId && message.status !== "sending"
          ? { ...message, status: "queued", error: undefined, pauseRequested: false } : message))
      },
      remove(id) {
        commit(get().messages.filter(message => message.id !== id || message.status === "sending"))
      },
      discardThread(threadId) {
        const messages = get().messages.filter(message => message.threadId !== threadId)
        if (messages.length === get().messages.length) return
        try { commit(messages) } catch (error) { set({ messages }); throw error }
      },
    }
  })
}

export const useMessageQueueStore = createMessageQueueStore()
