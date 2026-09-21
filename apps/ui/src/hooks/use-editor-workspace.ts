import { useEffect, useRef } from "react"
import { useChatStore } from "@/lib/chat-store"
import { resolveThreadRuntimePath } from "@/lib/thread-context"
import { selectEditorWorkspaceThread } from "@/lib/editor-workspace"
import { readEditorChatLayout } from "@/lib/editor-chat-layout"

const STORAGE_KEY = "betterc0de.editor.last-workspace"

/** Restore a known workspace when entering the editor without a folder. */
export function useEditorWorkspace(appMode: string, threadsReady: boolean) {
  const threads = useChatStore((state) => state.threads)
  const activeId = useChatStore((state) => state.activeThreadId)
  const entered = useRef(false)
  const remembered = useRef<string | null>(null)
  useEffect(() => {
    if (appMode !== "editor") {
      entered.current = false
      return
    }
    // Launch-folder selection may have run earlier in the same effect flush.
    const store = useChatStore.getState()
    const activePath = resolveThreadRuntimePath(
      store.threads.find((thread) => thread.id === store.activeThreadId)
    )
    if (activePath) {
      entered.current = true
      if (remembered.current !== activePath) {
        remembered.current = activePath
        try {
          localStorage.setItem(STORAGE_KEY, activePath)
        } catch {
          /* Storage may be unavailable. */
        }
      }
      return
    }
    if (entered.current || !threadsReady) return
    let saved = remembered.current
    try {
      saved = localStorage.getItem(STORAGE_KEY) || saved
    } catch {
      /* Use the in-memory selection. */
    }
    const layout = readEditorChatLayout()
    const selectedThreadId = layout?.tabs.find(
      (tab) => tab.id === layout.activeTabId
    )?.threadId
    const thread = selectEditorWorkspaceThread(threads, saved, selectedThreadId)
    if (!thread) return // The initial thread list may still be loading.
    entered.current = true
    useChatStore.getState().setActiveThread(thread.id)
    window.dispatchEvent(
      new CustomEvent("betterc0de:open-thread", {
        detail: { threadId: thread.id },
      })
    )
  }, [appMode, activeId, threads, threadsReady])
}
