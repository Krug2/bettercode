type EmitFn = (event: { event_type: string; thread_id: string; payload: Record<string, unknown> }) => void;

// [REASON-TRACE:CLAUDE-XLAT-OUT] tap on every translator emission.
function _wrap(emit: EmitFn): EmitFn {
  return (event) => {
    if (process.env.BETTERC0DE_TRACE_PROVIDER_EVENTS !== "1") {
      emit(event);
      return;
    }
    const dl = (event.payload?.delta as string | undefined)?.length ?? 0;
    const tl = (event.payload?.text as string | undefined)?.length ?? 0;
    console.log(`[REASON-TRACE:CLAUDE-XLAT-OUT] type=${event.event_type} deltaLen=${dl} textLen=${tl}`);
    emit(event);
  };
}

/**
 * Translate one SDK message into zero or more renderer events.
 *
 * The SDK streams a heterogeneous sequence: assistant text blocks, thinking
 * blocks, tool_use blocks, stream_event deltas, and final result frames.
 * This function is the single place that maps SDK shapes onto the
 * `event_type` vocabulary the renderer already understands.
 */
export function processClaudeSdkMessage(
  threadId: string,
  msg: unknown,
  emitRaw: EmitFn,
): string | null {
  if (!msg || typeof msg !== "object") return null;
  const emit = _wrap(emitRaw);
  const m = asRecord(msg);
  const message = asRecord(m.message);

  switch (m.type) {
    case "assistant": {
      const content = Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        const value = asRecord(block);
        const type = value.type;
        if (type === "text") {
          const text = typeof value.text === "string" ? value.text : "";
          if (text) emit({ event_type: "content_replace", thread_id: threadId, payload: { text } });
        } else if (type === "thinking") {
          const text = typeof value.thinking === "string" ? value.thinking : "";
          if (text) emit({ event_type: "reasoning_replace", thread_id: threadId, payload: { text } });
        } else if (type === "tool_use") {
          emit({
            event_type: "tool_call",
            thread_id: threadId,
            payload: { tool_id: typeof value.id === "string" ? value.id : "", tool_name: typeof value.name === "string" ? value.name : "", input: value.input ?? {} },
          });
        }
      }
      break;
    }
    case "stream_event": {
      // Partial incremental deltas. The SDK shapes this as the raw Anthropic
      // SSE `content_block_delta`; we unpack text + thinking.
      const delta = asRecord(asRecord(m.event).delta ?? m.delta);
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        emit({ event_type: "content_delta", thread_id: threadId, payload: { delta: delta.text } });
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
        emit({ event_type: "reasoning_delta", thread_id: threadId, payload: { delta: delta.thinking } });
      }
      break;
    }
    case "result": {
      const usageValue = m.usage ?? message.usage ?? asRecord(m.result).usage;
      if (usageValue) {
        const usage = asRecord(usageValue);
        const inputTokens = tokenCount(usage.input_tokens);
        const outputTokens = tokenCount(usage.output_tokens);
        emit({
          event_type: "token_usage",
          thread_id: threadId,
          payload: { usage: { inputTokens, outputTokens, usedTokens: inputTokens + outputTokens } },
        });
      }
      const subtype = typeof m.subtype === "string" ? m.subtype : "";
      if (m.is_error === true || subtype === "error" || subtype === "failure" || subtype.startsWith("error_")) {
        const errors = Array.isArray(m.errors) ? m.errors.filter((error): error is string => typeof error === "string" && error.length > 0) : [];
        const legacyError = asRecord(m.result).error;
        return (
          errors.join("\n") ||
          (typeof legacyError === "string" && legacyError) ||
          "Agent SDK reported a failure"
        );
      }
      break;
    }
    default:
      // Other subtypes (system/status/notification/auth_status/etc.) are
      // ignored — they'd only add noise without dedicated UI affordances.
      break;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
