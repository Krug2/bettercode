import type { ChatMessage } from "@betterc0de/schema"

export const COMPACTED_CONTEXT_HEADING = "# Compacted Session Context"

/** Presentation-only: internal checkpoints must remain in provider history.
 * The paired legacy format supports handoffs persisted before metadata. */
export function providerHandoffMessageIds(messages: readonly ChatMessage[]): ReadonlySet<string> {
  const legacyHandoffTimes = new Set(messages.filter(message =>
    message.role === "assistant" && message.compactedContext === true &&
    message.content.startsWith("# Provider Handoff\n\nPrepared by ")
  ).map(message => message.createdAt))
  return new Set(messages.filter(message =>
    message.internalContext === "provider-handoff" ||
    (legacyHandoffTimes.has(message.createdAt) && (
      (message.role === "assistant" && message.compactedContext === true && message.content.startsWith("# Provider Handoff\n\nPrepared by ")) ||
      (message.role === "user" && /^Provider handoff: \S+ → \S+$/u.test(message.content))
    ))
  ).map(message => message.id))
}

export function previousVisibleUserMessage(messages: readonly ChatMessage[], beforeIndex: number): ChatMessage | undefined {
  const hiddenIds = providerHandoffMessageIds(messages)
  for (let index = beforeIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "user" && !hiddenIds.has(message.id)) return message
  }
  return undefined
}

export interface ActiveContextSlice<T> {
  readonly messages: T[]
  readonly compactionIndex: number | null
}

export function activeContextMessages<
  T extends {
    readonly role: string
    readonly content: string
    readonly compactedContext?: boolean
  },
>(messages: ReadonlyArray<T>): ActiveContextSlice<T> {
  let compactionIndex: number | null = null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message?.role === "assistant" &&
      (message.compactedContext === true ||
        isLegacyCompactionCheckpoint(messages, index))
    ) {
      compactionIndex = index
      break
    }
  }

  return {
    messages:
      compactionIndex === null
        ? [...messages]
        : messages.slice(compactionIndex),
    compactionIndex,
  }
}

function isLegacyCompactionCheckpoint<
  T extends { readonly role: string; readonly content: string },
>(messages: ReadonlyArray<T>, index: number): boolean {
  const message = messages[index]
  const previous = messages[index - 1]
  return Boolean(
    message?.content.startsWith(COMPACTED_CONTEXT_HEADING) &&
      previous?.role === "user" &&
      /^\/compact(?:\s|$)/iu.test(previous.content.trim())
  )
}
