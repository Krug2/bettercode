import { useChatStore } from "@/lib/chat-store"
import { resolveNewThreadContext } from "@/lib/thread-context"

/**
 * Create a new empty thread and return its id. Shared by the composer-tabs
 * (editor mode) and panes (agent mode) hooks so both spawn threads the same
 * way, inheriting the active thread's project context.
 *
 * ⚠️ NEVER call this inside a `setState` updater — React StrictMode
 * double-invokes updaters in dev, which would spawn two orphan threads per
 * click. Always call it in the outer event handler before invoking setState.
 */
export function createEmptyThreadForTab(label: string): string {
  const store = useChatStore.getState()
  const activeThread = store.activeThreadId
    ? store.threads.find((thread) => thread.id === store.activeThreadId)
    : null
  const context = resolveNewThreadContext({ activeThread })
  return store.createThread(
    label,
    context.projectName,
    context.projectPath,
    context.options
  )
}
