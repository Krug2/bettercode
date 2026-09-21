import { type ChatSendBody } from "@betterc0de/schema"
import type { AppState } from "../../appState"
import { HttpError } from "../../errors"
import { logger } from "../../observability/logger"
import type {
  HistoryMessage,
  ProviderSendTurnInput,
} from "../../provider/types"
import { autoSaveConversationsEnabled } from "./automatic-compaction"

export function providerHistoryForDispatch(
  state: AppState,
  body: ChatSendBody,
  currentUserMessageId: string | null
): ProviderSendTurnInput["history"] {
  if (!autoSaveConversationsEnabled(state)) {
    return validatedRendererHistoryFallback(body)
  }
  const buildProviderHistory = state.threads.buildProviderHistory
  if (typeof buildProviderHistory !== "function") {
    logger.warn(
      { thread: body.thread_id },
      "durable provider history builder unavailable; using validated renderer fallback"
    )
    return validatedRendererHistoryFallback(body)
  }
  try {
    return buildProviderHistory.call(
      state.threads,
      body.thread_id,
      currentUserMessageId ? { excludeMessageId: currentUserMessageId } : {}
    )
  } catch (err) {
    logger.error(
      { err, thread: body.thread_id },
      "durable provider history unavailable; refusing provider dispatch"
    )
    throw new HttpError(
      503,
      "Conversation history is temporarily unavailable. Please retry after recovery completes.",
      "provider_history_unavailable"
    )
  }
}

function validatedRendererHistoryFallback(
  body: ChatSendBody
): HistoryMessage[] {
  const history = [...body.history]
  const validated: HistoryMessage[] = []
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]
    if (!message) continue
    if (message.role === "user") {
      validated.push({ role: "user", content: message.content })
      continue
    }
    if (message.role !== "assistant") continue

    const calls = uniqueRendererToolCalls(message.tool_calls)
    if (calls.length === 0) {
      validated.push({ role: "assistant", content: message.content })
      continue
    }
    const results = new Map<string, HistoryMessage>()
    let nextIndex = index + 1
    while (nextIndex < history.length && history[nextIndex]?.role === "tool") {
      const toolMessage = history[nextIndex]
      const toolCallId = toolMessage?.tool_call_id
      if (
        toolMessage &&
        typeof toolCallId === "string" &&
        calls.some((call) => call.id === toolCallId) &&
        !results.has(toolCallId)
      ) {
        results.set(toolCallId, {
          role: "tool",
          tool_call_id: toolCallId,
          content: toolMessage.content,
        })
      }
      nextIndex += 1
    }
    if (calls.every((call) => results.has(call.id))) {
      validated.push({
        role: "assistant",
        content: message.content,
        tool_calls: calls,
      })
      for (const call of calls) validated.push(results.get(call.id)!)
    } else if (message.content.length > 0) {
      validated.push({ role: "assistant", content: message.content })
    }
    index = nextIndex - 1
  }
  return validated
}

function uniqueRendererToolCalls(
  calls: HistoryMessage["tool_calls"]
): NonNullable<HistoryMessage["tool_calls"]> {
  if (!Array.isArray(calls)) return []
  const seen = new Set<string>()
  const unique: NonNullable<HistoryMessage["tool_calls"]> = []
  for (const call of calls) {
    if (!call.id || !call.name || seen.has(call.id)) continue
    seen.add(call.id)
    unique.push(call)
  }
  return unique
}
