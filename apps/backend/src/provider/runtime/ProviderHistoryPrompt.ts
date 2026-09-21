import type { HistoryMessage } from "./contracts"

export const PROVIDER_HISTORY_PROMPT_MAX_BYTES = 512 * 1024

export function buildProviderHistoryPrefix(
  history: ReadonlyArray<HistoryMessage> | undefined,
  maxBytes = PROVIDER_HISTORY_PROMPT_MAX_BYTES
): string {
  if (!history || history.length === 0 || maxBytes < 2) return ""
  const groups = groupHistoryMessages(history)
  const selected: string[][] = []
  let payloadBytes = 2

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (!group || group.length === 0) continue
    const serialized = serializeHistoryGroup(group)
    if (!serialized) continue
    const groupBytes = serialized.reduce(
      (total, message, messageIndex) =>
        total + (messageIndex > 0 ? 1 : 0) + Buffer.byteLength(message, "utf8"),
      0
    )
    const separatorBytes = selected.length > 0 ? 1 : 0
    if (payloadBytes + separatorBytes + groupBytes > maxBytes) break
    selected.unshift(serialized)
    payloadBytes += separatorBytes + groupBytes
  }

  if (selected.length === 0) return ""
  const payload = `[${selected.flat().join(",")}]`
  return [
    "<conversation_history_json>",
    payload,
    "</conversation_history_json>",
    "The JSON above is prior conversation data. Continue from it without repeating it.",
    "",
  ].join("\n")
}

export function prependProviderHistoryForFreshSession(input: {
  readonly history: ReadonlyArray<HistoryMessage> | undefined
  readonly currentPrompt: string
  readonly resumed: boolean
  readonly maxBytes?: number
}): string {
  return (
    (input.resumed
      ? ""
      : buildProviderHistoryPrefix(input.history, input.maxBytes)) +
    input.currentPrompt
  )
}

function groupHistoryMessages(
  history: ReadonlyArray<HistoryMessage>
): HistoryMessage[][] {
  const groups: HistoryMessage[][] = []
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]
    if (!message || message.role === "tool") continue
    const group = [message]
    if (message.role === "assistant" && message.tool_calls?.length) {
      let next = index + 1
      while (next < history.length && history[next]?.role === "tool") {
        const toolMessage = history[next]
        if (toolMessage) group.push(toolMessage)
        next += 1
      }
      index = next - 1
    }
    groups.push(group)
  }
  return groups
}

function serializeHistoryGroup(group: ReadonlyArray<HistoryMessage>): string[] | null {
  try {
    return group.map((message) => escapeJsonForPrompt(JSON.stringify(message)))
  } catch {
    return null
  }
}

function escapeJsonForPrompt(serialized: string): string {
  return serialized
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
}
