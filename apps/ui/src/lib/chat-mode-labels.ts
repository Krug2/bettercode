/**
 * Display names for the chat modes.
 *
 * The composer chip used to render the raw mode id with a `capitalize` class,
 * so renaming a mode in the dropdown left the chip showing the old word. One
 * map keeps the two in step.
 */
const CHAT_MODE_LABELS: Record<string, string> = {
  agent: "Agent",
  plan: "Plan",
  // Names what the mode guarantees: the agent may read and search the
  // workspace but never change it.
  ask: "Ask / Read-only",
}

export function chatModeLabel(chatMode: string | null | undefined): string {
  const key = chatMode?.trim().toLowerCase()
  if (!key) return CHAT_MODE_LABELS.agent
  return CHAT_MODE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/** The modes that still exist. Security and Debug were removed. */
export const CHAT_MODES = ["agent", "plan", "ask"] as const
export type KnownChatMode = (typeof CHAT_MODES)[number]

const KNOWN = new Set<string>(CHAT_MODES)

/**
 * Coerce a stored mode to one that still exists.
 *
 * Thread settings persist to localStorage, so a chat last used in the removed
 * Security or Debug mode still carries that value. Without this it would keep
 * being read as a live mode: labelled from the capitalize fallback, and — worse
 * — still matching the mode-instruction lookups, so the thread would silently
 * behave like a mode the user can no longer see or leave.
 *
 * Anything unrecognised becomes Agent, the mode with no special rules.
 */
export function normalizeChatMode(
  chatMode: string | null | undefined
): KnownChatMode {
  const key = chatMode?.trim().toLowerCase()
  return key && KNOWN.has(key) ? (key as KnownChatMode) : "agent"
}
