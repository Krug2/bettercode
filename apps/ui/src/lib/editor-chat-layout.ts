export interface EditorChatTab {
  id: string
  threadId: string | null
  label: string
}
export interface EditorChatLayout {
  tabs: EditorChatTab[]
  activeTabId: string
  splitTabIds: string[] | null
}
export const EDITOR_CHAT_LAYOUT_KEY = "betterc0de.editor.chat-layout"

/**
 * Editor and Design render the same chat container (`ChatWorkbenchPanel`)
 * with the same composer tab strip and the same persisted layout; only Agent
 * mode has its own pane grid. Every guard that used to ask "is this the
 * editor?" meant "does this mode use composer tabs?" — asking the first
 * question left Design without layout persistence and without following the
 * active thread.
 */
export function usesComposerTabs(appMode: string | null | undefined): boolean {
  return appMode !== "agent"
}

export function parseEditorChatLayout(
  raw: string | null
): EditorChatLayout | null {
  try {
    if (!raw || raw.length > 32_000) return null
    const value = JSON.parse(raw)
    if (value?.version !== 1 || !Array.isArray(value.tabs)) return null
    const ids = new Set<string>()
    const threadIds = new Set<string>()
    const tabs: EditorChatTab[] = []
    for (const tab of value.tabs.slice(0, 12)) {
      if (
        !tab ||
        typeof tab.id !== "string" ||
        !tab.id ||
        tab.id.length > 100 ||
        ids.has(tab.id)
      )
        continue
      if (
        tab.threadId !== null &&
        (typeof tab.threadId !== "string" ||
          !tab.threadId ||
          tab.threadId.length > 100 ||
          threadIds.has(tab.threadId))
      )
        continue
      ids.add(tab.id)
      if (tab.threadId) threadIds.add(tab.threadId)
      tabs.push({
        id: tab.id,
        threadId: tab.threadId,
        label: typeof tab.label === "string" ? tab.label.slice(0, 120) : "Chat",
      })
    }
    if (!tabs.length) return null
    const splitTabIds = Array.isArray(value.splitTabIds)
      ? [
          ...new Set<string>(
            value.splitTabIds.filter(
              (id: unknown): id is string =>
                typeof id === "string" && ids.has(id)
            )
          ),
        ]
      : []
    return {
      tabs,
      activeTabId: ids.has(value.activeTabId) ? value.activeTabId : tabs[0].id,
      splitTabIds: splitTabIds.length > 1 ? splitTabIds : null,
    }
  } catch {
    return null
  }
}

export function readEditorChatLayout(): EditorChatLayout | null {
  try {
    return parseEditorChatLayout(localStorage.getItem(EDITOR_CHAT_LAYOUT_KEY))
  } catch {
    return null
  }
}
