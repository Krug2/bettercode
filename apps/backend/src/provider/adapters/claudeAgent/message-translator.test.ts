import { describe, expect, it } from "vitest";
import { processClaudeSdkMessage } from "./message-translator";
import { getThinkingOptions } from "./sdk-types";

type LegacyEvent = {
  event_type: string;
  thread_id: string;
  payload: Record<string, unknown>;
};

describe("processClaudeSdkMessage", () => {
  it.each(["error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries", "success"])("preserves SDK failure %s", (subtype) => {
    const events: LegacyEvent[] = [];
    expect(processClaudeSdkMessage("thread-1", { type: "result", subtype, is_error: true, errors: ["provider failed"] }, (event) => events.push(event))).toBe("provider failed");
    expect(events).toEqual([]);
  });

  it("reads top-level SDK usage before legacy nested usage", () => {
    const events: LegacyEvent[] = [];
    processClaudeSdkMessage("thread-1", {
      type: "result", subtype: "success", usage: { input_tokens: 7, output_tokens: 3 },
      message: { usage: { input_tokens: 99, output_tokens: 99 } },
    }, (event) => events.push(event));
    expect(events).toEqual([{ event_type: "token_usage", thread_id: "thread-1", payload: { usage: { inputTokens: 7, outputTokens: 3, usedTokens: 10 } } }]);
  });

  it("ignores malformed SDK content and usage values", () => {
    const events: LegacyEvent[] = [];
    for (const content of [{ type: "text" }, [null, 42, { type: "text", text: {} }]]) {
      expect(() => processClaudeSdkMessage("thread-1", { type: "assistant", message: { content } }, (event) => events.push(event))).not.toThrow();
    }
    processClaudeSdkMessage("thread-1", { type: "result", usage: { input_tokens: "7", output_tokens: -1 } }, (event) => events.push(event));
    expect(events).toEqual([{ event_type: "token_usage", thread_id: "thread-1", payload: { usage: { inputTokens: 0, outputTokens: 0, usedTokens: 0 } } }]);
  });

  it("emits reasoning deltas from SDK stream_event.event.delta", () => {
    const events: LegacyEvent[] = [];

    processClaudeSdkMessage(
      "thread-1",
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "thought" },
        },
      },
      (event) => events.push(event),
    );

    expect(events).toEqual([
      {
        event_type: "reasoning_delta",
        thread_id: "thread-1",
        payload: { delta: "thought" },
      },
    ]);
  });

  it("keeps the older top-level delta fallback", () => {
    const events: LegacyEvent[] = [];

    processClaudeSdkMessage(
      "thread-1",
      {
        type: "stream_event",
        delta: { type: "text_delta", text: "hello" },
      },
      (event) => events.push(event),
    );

    expect(events).toEqual([
      {
        event_type: "content_delta",
        thread_id: "thread-1",
        payload: { delta: "hello" },
      },
    ]);
  });

  it("returns result failures without emitting adapter-owned terminal events", () => {
    const events: LegacyEvent[] = [];

    const failure = processClaudeSdkMessage(
      "thread-1",
      {
        type: "result",
        subtype: "failure",
        result: { error: "agent failed" },
      },
      (event) => events.push(event),
    );

    expect(failure).toBe("agent failed");
    expect(events).toEqual([]);
  });
});

describe("getThinkingOptions", () => {
  it.each(["constructor", "__proto__", "unknown"])("ignores unrecognized effort %s", (effort) => {
    expect(getThinkingOptions(effort, "claude-opus-4-7")).toEqual({});
  });

  it("returns just the effort field — no `thinking` config", () => {
    expect(getThinkingOptions("xHigh", "claude-opus-4-7")).toEqual({ effort: "max" });
    expect(getThinkingOptions("High", "claude-haiku-4-5-20251001")).toEqual({ effort: "high" });
    expect(getThinkingOptions("Max", "claude-opus-4-7")).toEqual({ effort: "max" });
    expect(getThinkingOptions(null, "claude-opus-4-7")).toEqual({});
  });
});
