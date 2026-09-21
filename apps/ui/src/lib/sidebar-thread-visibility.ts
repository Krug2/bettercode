interface SidebarThreadSummary {
  title?: string | null
  messages?: ReadonlyArray<{ role?: string | null }>
  messageCount?: number
}

const AUTOMATIC_COMPOSER_PLACEHOLDER_RE = /^Chat \d+$/

/**
 * Keep intentionally-created empty threads visible while hiding the automatic
 * "Chat N" records used internally by new composer tabs.
 *
 * A thread created through the New Thread dialog is titled "New Chat" and is
 * a real project entry even before the first prompt is sent. Previously every
 * zero-message thread was filtered out, so its selected project disappeared
 * from the sidebar immediately after creation.
 */
export function shouldShowThreadInSidebar(
  thread: SidebarThreadSummary,
  isHydrated: boolean
): boolean {
  const hasConversation = isHydrated
    ? thread.messages?.some((message) => message.role === "user") === true
    : (thread.messageCount ?? 0) > 0

  if (hasConversation) return true
  return !AUTOMATIC_COMPOSER_PLACEHOLDER_RE.test(thread.title?.trim() ?? "")
}
