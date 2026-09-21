type TitleThread =
  | {
      title?: string
      messages?: ReadonlyArray<{ role: string; content: string }>
    }
  | null
  | undefined

/**
 * Derive a human display title for a thread — prefer the first user message
 * (matches how the sidebar derives titles), then the thread's own title, then
 * the provided fallback. Extracted from the composer-tab label logic so panes,
 * pane tabs, and the tab strip all label chats identically.
 */
export function deriveThreadTitle(
  thread: TitleThread,
  fallback: string
): string {
  if (!thread) return fallback
  const firstUser = thread.messages?.find((m) => m.role === "user")
  if (firstUser?.content) {
    const trimmed = firstUser.content.trim().replace(/\s+/g, " ")
    if (trimmed.length > 0) {
      return trimmed.length > 28 ? trimmed.slice(0, 28) + "…" : trimmed
    }
  }
  if (thread.title && thread.title !== "New Chat") return thread.title
  return fallback
}
