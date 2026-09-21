import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react"
import { useChatStore } from "@/lib/chat-store"
import { usePreferencesStore } from "@/lib/preferences-store"
import { resolveNewThreadContext } from "@/lib/thread-context"
import {
  EDITOR_CHAT_LAYOUT_KEY,
  readEditorChatLayout,
  usesComposerTabs,
} from "@/lib/editor-chat-layout"

export type ComposerTab = {
  id: string
  threadId: string | null
  label: string
}

const MAX_COMPOSER_TABS = 12
const MAX_SPLIT = 12

/**
 * Create a new empty thread and return its id, so each tab has its own
 * thread from the moment it's opened (prevents two split tabs accidentally
 * sharing the same activeThreadId and rendering the same messages).
 *
 * ⚠️ NEVER call this inside a `setState` updater — React StrictMode
 * double-invokes updaters in dev, which would spawn two orphan threads per
 * click. Always call it in the outer event handler before invoking setState.
 */
function createEmptyThreadForTab(label: string): string {
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

/**
 * Multi-tab composer state + shortcut glue.
 *
 * All thread-creating callbacks follow the same pattern:
 *   1. compute side effects (createThread) OUTSIDE any updater
 *   2. commit pure state updates via `setComposerTabs(prev => …)` and
 *      `setSplitTabIds(prev => …)` — never nested
 *
 * That rule is load-bearing: before this refactor the hooks called
 * createThread inside setState updaters, which StrictMode ran twice,
 * causing cascading re-renders and occasional UI hangs on "+".
 */
export function useComposerTabs() {
  const [restoredLayout] = useState(readEditorChatLayout)
  const appMode = usePreferencesStore((state) => state.appMode)
  const [composerTabs, updateComposerTabs] = useState<ComposerTab[]>(
    restoredLayout?.tabs ?? [{ id: "tab-1", threadId: null, label: "Chat 1" }]
  )
  const [activeComposerTab, updateActiveComposerTab] = useState(
    restoredLayout?.activeTabId ?? "tab-1"
  )
  /**
   * Ordered list of tab ids rendered simultaneously in split mode.
   * `null` means non-split: only the active tab renders. When populated,
   * MainArea renders one ChatColumn per id in a vertical stack. Capped at
   * MAX_SPLIT; short windows scroll the stack.
   */
  const [splitTabIds, setSplitTabIds] = useState<string[] | null>(
    restoredLayout?.splitTabIds ?? null
  )

  useEffect(() => {
    if (!usesComposerTabs(appMode)) return
    try {
      localStorage.setItem(
        EDITOR_CHAT_LAYOUT_KEY,
        JSON.stringify({
          version: 1,
          tabs: composerTabs,
          activeTabId: activeComposerTab,
          splitTabIds,
        })
      )
    } catch {
      /* Chats remain durable in the backend if layout storage fails. */
    }
  }, [appMode, composerTabs, activeComposerTab, splitTabIds])

  // The workspace event and selection effect can arrive in the same flush.
  // Update refs synchronously so the second request reuses the first tab.
  const composerTabsRef = useRef(composerTabs)
  const activeComposerTabRef = useRef(activeComposerTab)
  const setComposerTabs = useCallback(
    (action: SetStateAction<ComposerTab[]>) => {
      const next =
        typeof action === "function" ? action(composerTabsRef.current) : action
      composerTabsRef.current = next
      updateComposerTabs(next)
    },
    []
  )
  const setActiveComposerTab = useCallback((id: string) => {
    activeComposerTabRef.current = id
    updateActiveComposerTab(id)
  }, [])

  const addComposerTab = useCallback(() => {
    const current = composerTabsRef.current
    if (current.length >= MAX_COMPOSER_TABS) return
    const label = `Chat ${current.length + 1}`
    const threadId = createEmptyThreadForTab(label)
    const newTab: ComposerTab = {
      id: `tab-${crypto.randomUUID()}`,
      threadId,
      label,
    }
    setComposerTabs((prev) => [...prev, newTab])
    setActiveComposerTab(newTab.id)
    setSplitTabIds(null)
    useChatStore.getState().setActiveThread(threadId)
  }, [setActiveComposerTab, setComposerTabs])

  /**
   * Opens the given thread in a composer tab. The bug this fixes: clicking a
   * thread in the sidebar used to only call `setActiveThread`, but if the
   * matching tab had been closed earlier the main area rendered an empty
   * `Chat N` because no tab pointed at it. We now:
   *   1. activate the existing tab if one already has `threadId`
   *   2. otherwise reuse the currently-active tab if it's still empty
   *      (fresh "Chat 1" with `threadId === null`)
   *   3. otherwise append a new tab, respecting MAX_COMPOSER_TABS
   */
  const openThreadInTab = useCallback(
    (threadId: string, label?: string) => {
      if (!threadId) return
      const tabs = composerTabsRef.current
      const existing = tabs.find((t) => t.threadId === threadId)
      if (existing) {
        setActiveComposerTab(existing.id)
        setSplitTabIds((ids) =>
          ids && !ids.includes(existing.id) ? null : ids
        )
        useChatStore.getState().setActiveThread(threadId)
        return
      }

      const activeTabId = activeComposerTabRef.current
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const fallbackLabel = label ?? "Chat"

      if (activeTab && activeTab.threadId === null) {
        // Promote the blank "Chat N" placeholder to this thread.
        setComposerTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id ? { ...t, threadId, label: fallbackLabel } : t
          )
        )
        useChatStore.getState().setActiveThread(threadId)
        return
      }

      if (tabs.length >= MAX_COMPOSER_TABS) {
        // Last resort: overwrite the active tab so the user still sees the chat
        // they clicked rather than a silent no-op at the tab-count cap.
        setComposerTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, threadId, label: fallbackLabel } : t
          )
        )
        useChatStore.getState().setActiveThread(threadId)
        return
      }

      const newTab: ComposerTab = {
        id: `tab-${crypto.randomUUID()}`,
        threadId,
        label: fallbackLabel,
      }
      setComposerTabs((prev) => [...prev, newTab])
      setActiveComposerTab(newTab.id)
      setSplitTabIds(null)
      useChatStore.getState().setActiveThread(threadId)
    },
    [setActiveComposerTab, setComposerTabs]
  )

  const closeComposerTab = useCallback(
    (tabId: string) => {
      const current = composerTabsRef.current
      const index = current.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const remaining = current.filter((tab) => tab.id !== tabId)
      const isAvailable = (tab: ComposerTab) =>
        !tab.threadId ||
        useChatStore
          .getState()
          .threads.some((thread) => thread.id === tab.threadId)
      if (!remaining.some(isAvailable)) {
        remaining.push({
          id: `tab-${crypto.randomUUID()}`,
          threadId: createEmptyThreadForTab("Chat 1"),
          label: "Chat 1",
        })
      }
      const available = remaining.filter(isAvailable)
      const active =
        activeComposerTabRef.current === tabId
          ? available[Math.min(index, available.length - 1)]
          : (available.find((tab) => tab.id === activeComposerTabRef.current) ??
            available[0])
      composerTabsRef.current = remaining
      activeComposerTabRef.current = active.id
      setComposerTabs(remaining)
      setActiveComposerTab(active.id)
      if (active.threadId)
        useChatStore.getState().setActiveThread(active.threadId)
      setSplitTabIds((previous) => {
        const next = previous?.filter((id) => id !== tabId) ?? []
        return next.length > 1 ? next : null
      })
    },
    [setActiveComposerTab, setComposerTabs]
  )

  /**
   * Enter split mode — default to the first two tabs (creates a second
   * if needed). Any tab that still has `threadId === null` gets a fresh
   * empty thread assigned so both split columns render *different* chats
   * from the start.
   */
  const enterSplitMode = useCallback(() => {
    const current = composerTabsRef.current
    // Pre-compute all thread creations BEFORE setState so StrictMode's
    // double-invocation can't spawn duplicate threads.
    const promotions = new Map<string, string>()
    for (const t of current) {
      if (!t.threadId) promotions.set(t.id, createEmptyThreadForTab(t.label))
    }
    let newTab: ComposerTab | null = null
    if (current.length < 2 && current.length < MAX_COMPOSER_TABS) {
      const label = `Chat ${current.length + 1}`
      newTab = {
        id: `tab-${crypto.randomUUID()}`,
        threadId: createEmptyThreadForTab(label),
        label,
      }
    }

    const promoted = current.map((tab) =>
      promotions.has(tab.id)
        ? { ...tab, threadId: promotions.get(tab.id)! }
        : tab
    )
    const nextTabs = newTab ? [...promoted, newTab] : promoted
    const selected =
      nextTabs.find((tab) => tab.id === activeComposerTabRef.current) ??
      nextTabs[0]
    const second = nextTabs.find((tab) => tab.id !== selected.id)
    setComposerTabs(nextTabs)
    setSplitTabIds(second ? [selected.id, second.id] : null)
    if (selected.threadId)
      useChatStore.getState().setActiveThread(selected.threadId)
  }, [setComposerTabs])

  /**
   * Add a brand-new split column — creates a new tab + thread and
   * appends it to the split list. If split mode isn't active yet, also
   * promotes the currently-active tab into the split so the user ends up
   * with two stacked chats (original + new) instead of a
   * single-chat split.
   */
  const addSplitColumn = useCallback(() => {
    const current = composerTabsRef.current
    if (current.length >= MAX_COMPOSER_TABS) return
    const activeId = activeComposerTabRef.current

    const promotions = new Map<string, string>()
    for (const t of current) {
      if (!t.threadId) promotions.set(t.id, createEmptyThreadForTab(t.label))
    }
    const label = `Chat ${current.length + 1}`
    const newTab: ComposerTab = {
      id: `tab-${crypto.randomUUID()}`,
      threadId: createEmptyThreadForTab(label),
      label,
    }

    setComposerTabs((prev) => {
      const promoted = prev.map((t) =>
        promotions.has(t.id) ? { ...t, threadId: promotions.get(t.id)! } : t
      )
      return [...promoted, newTab]
    })
    setActiveComposerTab(newTab.id)
    setSplitTabIds((prev) => {
      if (!prev) {
        return activeId ? [activeId, newTab.id] : [newTab.id]
      }
      if (prev.length >= MAX_SPLIT) return prev
      return [...prev, newTab.id]
    })
  }, [setActiveComposerTab, setComposerTabs])

  const exitSplitMode = useCallback(() => {
    setSplitTabIds(null)
  }, [])

  /** Add `tabId` to the split view (up to MAX_SPLIT columns). */
  const addTabToSplit = useCallback((tabId: string) => {
    setSplitTabIds((prev) => {
      if (!prev) return [tabId]
      if (prev.includes(tabId)) return prev
      if (prev.length >= MAX_SPLIT) return prev
      return [...prev, tabId]
    })
  }, [])

  const removeTabFromSplit = useCallback((tabId: string) => {
    setSplitTabIds((prev) => {
      if (!prev) return prev
      const next = prev.filter((id) => id !== tabId)
      return next.length < 2 ? null : next
    })
  }, [])

  /** Reorder tabs in the tab bar — move source to target's position. */
  const reorderTab = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return
      setComposerTabs((prev) => {
        const fromIdx = prev.findIndex((t) => t.id === fromId)
        const toIdx = prev.findIndex((t) => t.id === toId)
        if (fromIdx < 0 || toIdx < 0) return prev
        const next = prev.slice()
        const [moved] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, moved)
        return next
      })
    },
    [setComposerTabs]
  )

  /**
   * Insert `tabId` into the split at `atIndex`. If already present, it's
   * moved to that position. Entering split mode implicitly.
   */
  const insertIntoSplit = useCallback(
    (tabId: string, atIndex: number) => {
      const tab = composerTabsRef.current.find((t) => t.id === tabId)
      if (!tab) return
      // Side effect (create thread) OUTSIDE setState
      const newThreadId = tab.threadId
        ? null
        : createEmptyThreadForTab(tab.label)
      if (newThreadId) {
        setComposerTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, threadId: newThreadId } : t
          )
        )
      }
      setSplitTabIds((prev) => {
        const base = prev ? prev.filter((id) => id !== tabId) : []
        const clamped = Math.max(0, Math.min(atIndex, base.length))
        const next = [...base.slice(0, clamped), tabId, ...base.slice(clamped)]
        return next.slice(0, MAX_SPLIT)
      })
    },
    [setComposerTabs]
  )

  const renameComposerTab = useCallback(
    (tabId: string, label: string) => {
      setComposerTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, label } : t))
      )
    },
    [setComposerTabs]
  )

  /**
   * Sync active composer tab with thread selection — but ONLY when the
   * user explicitly switches threads elsewhere (sidebar, dropdown). We
   * reuse existing bindings, so switching panels never replaces their chats.
   */
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  useEffect(() => {
    if (usesComposerTabs(appMode) && activeThreadId) {
      openThreadInTab(activeThreadId)
      return
    }
    setComposerTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeComposerTab) return t
        if (t.threadId) return t
        return { ...t, threadId: activeThreadId }
      })
    )
  }, [
    activeThreadId,
    activeComposerTab,
    appMode,
    openThreadInTab,
    setComposerTabs,
  ])

  // Global event bridge so components outside the hook (e.g. the sidebar
  // thread list) can request a thread be opened without drilling props
  // through every layer. The `betterc0de:open-thread` CustomEvent carries
  // `{ threadId, label? }`; see `src/components/sidebar/thread-list.tsx`.
  useEffect(() => {
    const handler = (e: Event) => {
      // Agent mode is driven by use-panes; only handle this in other modes.
      if (usePreferencesStore.getState().appMode === "agent") return
      const detail = (e as CustomEvent<{ threadId?: string; label?: string }>)
        .detail
      if (detail?.threadId) openThreadInTab(detail.threadId, detail.label)
    }
    window.addEventListener("betterc0de:open-thread", handler as EventListener)
    return () =>
      window.removeEventListener(
        "betterc0de:open-thread",
        handler as EventListener
      )
  }, [openThreadInTab])

  // Keyboard shortcut: Ctrl+1-8 to switch composer tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Agent mode is driven by use-panes; only handle this in other modes.
      if (usePreferencesStore.getState().appMode === "agent") return
      if (!(e.ctrlKey || e.metaKey)) return
      const num = parseInt(e.key)
      const tabs = composerTabsRef.current
      if (num >= 1 && num <= 8 && num <= tabs.length) {
        e.preventDefault()
        const tab = tabs[num - 1]
        if (
          tab.threadId &&
          !useChatStore
            .getState()
            .threads.some((thread) => thread.id === tab.threadId)
        )
          return
        setActiveComposerTab(tab.id)
        if (tab.threadId) {
          useChatStore.getState().setActiveThread(tab.threadId)
        }
      }
      // Ctrl+T: new composer tab
      if (e.key === "t" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        addComposerTab()
      }
      // Ctrl+W: close current composer tab
      if (e.key === "w" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const target = e.target instanceof Element ? e.target : null
        if (
          usePreferencesStore.getState().appMode === "editor" ||
          isComposerShortcutTextEntryTarget(target)
        ) {
          return
        }
        e.preventDefault()
        closeComposerTab(activeComposerTabRef.current)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [addComposerTab, closeComposerTab, setActiveComposerTab])

  const switchActiveTabToThread = useCallback(
    (threadId: string, label?: string) => {
      if (!threadId) return
      const tabs = composerTabsRef.current
      const existing = tabs.find((t) => t.threadId === threadId)
      if (existing) {
        if (activeComposerTabRef.current !== existing.id)
          setActiveComposerTab(existing.id)
        if (useChatStore.getState().activeThreadId !== threadId) {
          useChatStore.getState().setActiveThread(threadId)
        }
        return
      }
      const activeId = activeComposerTabRef.current
      const fallbackLabel =
        label ?? tabs.find((t) => t.id === activeId)?.label ?? "Chat"
      setComposerTabs((prev) => {
        const next = prev.map((t) =>
          t.id === activeId ? { ...t, threadId, label: fallbackLabel } : t
        )
        let changed = false
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== next[i]) {
            changed = true
            break
          }
        }
        return changed ? next : prev
      })
      if (useChatStore.getState().activeThreadId !== threadId) {
        useChatStore.getState().setActiveThread(threadId)
      }
    },
    [setActiveComposerTab, setComposerTabs]
  )

  return {
    composerTabs,
    activeComposerTab,
    setActiveComposerTab,
    addComposerTab,
    closeComposerTab,
    openThreadInTab,
    switchActiveTabToThread,
    renameComposerTab,
    maxComposerTabs: MAX_COMPOSER_TABS,
    splitTabIds,
    splitMode: splitTabIds !== null && splitTabIds.length > 0,
    maxSplit: MAX_SPLIT,
    enterSplitMode,
    exitSplitMode,
    addTabToSplit,
    removeTabFromSplit,
    addSplitColumn,
    reorderTab,
    insertIntoSplit,
  }
}

function isComposerShortcutTextEntryTarget(target: Element | null): boolean {
  if (!target) return false
  if (target.closest("[contenteditable='true']")) return true
  const element = target.closest("input, textarea, select")
  if (!element) return false
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !element.disabled
  }
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return !element.disabled
  }
  return true
}
