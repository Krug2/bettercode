/**
 * Wall-clock time a turn took: from the user message that triggered it to the
 * moment the assistant reply was finalized.
 *
 * Shown permanently under every answer, so it has to stay quiet about cases it
 * cannot measure honestly rather than render a misleading number.
 */

/**
 * Restored or imported histories can carry timestamps from another machine or
 * another day. Anything beyond this reads as "the workspace was closed
 * overnight", not as a turn duration, so it is suppressed.
 */
export const MAX_PLAUSIBLE_TURN_MS = 6 * 60 * 60 * 1000

interface TimedMessage {
  readonly role: string
  readonly createdAt?: string
}

/**
 * Milliseconds for the assistant message at `index`, or null when there is no
 * preceding user message or the timestamps are not usable.
 */
export function turnDurationMs(
  messages: ReadonlyArray<TimedMessage>,
  index: number
): number | null {
  const message = messages[index]
  if (!message || message.role !== "assistant") return null

  let trigger: TimedMessage | undefined
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") {
      trigger = messages[cursor]
      break
    }
  }
  if (!trigger) return null

  const finishedAt = Date.parse(message.createdAt ?? "")
  const startedAt = Date.parse(trigger.createdAt ?? "")
  if (!Number.isFinite(finishedAt) || !Number.isFinite(startedAt)) return null

  const elapsed = finishedAt - startedAt
  if (elapsed <= 0 || elapsed > MAX_PLAUSIBLE_TURN_MS) return null
  return elapsed
}
