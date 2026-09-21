import type { ChatThread } from "@betterc0de/schema"

/** The subset of a composer tab the switcher needs. */
export interface ChatSwitcherTab {
  id: string
  threadId: string | null
  label: string
}

/**
 * What a chat is called in the switcher and the tab strip: the first user
 * message (how the sidebar titles chats), else the thread's own title unless
 * it is still the placeholder, else the tab's static label.
 */
export function chatTabLabel(
  tab: Pick<ChatSwitcherTab, "label">,
  thread: Pick<ChatThread, "title" | "messages"> | undefined,
  maxLength = 28
): string {
  if (!thread) return tab.label
  const firstUser = thread.messages.find((message) => message.role === "user")
  const trimmed = firstUser?.content?.trim().replace(/\s+/g, " ") ?? ""
  if (trimmed.length > 0) {
    return trimmed.length > maxLength
      ? trimmed.slice(0, maxLength) + "…"
      : trimmed
  }
  if (thread.title && !isPlaceholderTitle(thread.title)) return thread.title
  return tab.label
}

/** Titles the app assigns before a chat has content. */
export function isPlaceholderTitle(title: string): boolean {
  return /^(New (Chat|Design|Task)|Chat \d+)$/i.test(title.trim())
}

export function threadHistoryTitle(
  thread: Pick<ChatThread, "title" | "messages">,
  maxLength = 60
): string {
  return chatTabLabel({ label: thread.title || "Chat" }, thread, maxLength)
}

export interface ChatHistoryBuckets {
  /** Chats in the current project, newest first. */
  project: ChatThread[]
  /** Chats elsewhere, newest first. Empty when there is no current project. */
  elsewhere: ChatThread[]
}

/**
 * Chats worth reopening: not already open in a tab, and not an untouched
 * placeholder (a fresh "Chat 3" with nothing in it is noise, not history).
 * `messageCount` is the backend's persisted count — the list is populated
 * before messages hydrate, so `messages.length` alone would hide real chats.
 */
export function buildChatHistory(input: {
  threads: readonly ChatThread[]
  openThreadIds: ReadonlySet<string>
  projectPath: string | null | undefined
  limit?: number
}): ChatHistoryBuckets {
  const limit = input.limit ?? 30
  const project = normalizePath(input.projectPath)
  const candidates = input.threads
    .filter((thread) => !input.openThreadIds.has(thread.id))
    .filter((thread) => (thread.messageCount ?? thread.messages.length) > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const inProject: ChatThread[] = []
  const elsewhere: ChatThread[] = []
  for (const thread of candidates) {
    if (project && normalizePath(thread.projectPath) === project) {
      if (inProject.length < limit) inProject.push(thread)
    } else if (elsewhere.length < limit) {
      elsewhere.push(thread)
    }
  }
  return { project: inProject, elsewhere }
}

/**
 * The order the switcher lists open chats in: the active chat first, then
 * the rest by last activity, and tabs with nothing in them last. Tab order is
 * the order chats were opened, which put an untouched first tab above the
 * chat the user is actually in.
 */
export function orderOpenChats<T extends Pick<ChatSwitcherTab, "id" | "threadId">>(
  tabs: readonly T[],
  input: {
    activeTabId: string | null | undefined
    threadById: (
      threadId: string | null
    ) => Pick<ChatThread, "updatedAt" | "messageCount" | "messages"> | undefined
  }
): T[] {
  const ranked = tabs.map((tab, index) => {
    const thread = input.threadById(tab.threadId)
    const hasContent = thread
      ? (thread.messageCount ?? thread.messages.length) > 0
      : false
    return {
      tab,
      active: tab.id === input.activeTabId ? 0 : 1,
      empty: hasContent ? 0 : 1,
      activity: thread ? Date.parse(thread.updatedAt) || 0 : 0,
      index,
    }
  })
  ranked.sort(
    (a, b) =>
      a.active - b.active ||
      a.empty - b.empty ||
      b.activity - a.activity ||
      a.index - b.index
  )
  return ranked.map((entry) => entry.tab)
}

function normalizePath(value: string | null | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}
