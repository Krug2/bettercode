import { describe, expect, it } from "vitest"
import type { ProviderRuntimeEvent } from "./contracts"
import { providerRuntimeEventSchema } from "./contracts"
import { canonicalToLegacy } from "./legacyBridge"

function base(): {
  threadId: string
  providerKind: "codex"
  providerInstanceId: string
  eventId: string
  at: number
} {
  return {
    threadId: "thread-1",
    providerKind: "codex",
    providerInstanceId: "codex-work",
    eventId: "event-1",
    at: 123,
  }
}

describe("canonicalToLegacy", () => {
  it("accepts runtime base fields before bridging", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "session.started",
      eventId: "event-1",
      provider: "claudeAgent",
      providerInstanceId: "claude-main",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      payload: {
        message: "started",
      },
    })

    expect(parsed).toMatchObject({
      type: "session.started",
      eventId: "event-1",
      provider: "claudeAgent",
      providerInstanceId: "claude-main",
      at: 0,
      createdAt: "2026-02-28T00:00:00.000Z",
    })
  })

  it("accepts BetterC0de CLI provider kinds on runtime events", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "content.delta",
      eventId: "event-1",
      threadId: "thread-1",
      providerKind: "anthropic_cli",
      providerInstanceId: "claude-main",
      streamKind: "assistant_text",
      delta: "hello",
    })

    expect(canonicalToLegacy(parsed)).toEqual({
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: {
        delta: "hello",
        streamKind: "assistant_text",
        turn_id: undefined,
        providerKind: "anthropic_cli",
        providerInstanceId: "claude-main",
      },
    })
  })

  it("passes plan and unknown content stream kinds through as content deltas", () => {
    for (const streamKind of ["plan_text", "unknown"] as const) {
      const parsed = providerRuntimeEventSchema.parse({
        type: "content.delta",
        eventId: `event-${streamKind}`,
        threadId: "thread-1",
        providerKind: "codex",
        providerInstanceId: "codex-work",
        payload: {
          streamKind,
          delta: "partial text",
        },
      })

      expect(canonicalToLegacy(parsed)).toEqual({
        event_type: "content_delta",
        thread_id: "thread-1",
        payload: {
          providerKind: "codex",
          providerInstanceId: "codex-work",
          delta: "partial text",
          streamKind,
          turn_id: undefined,
        },
      })
    }
  })

  it("maps provider driver slugs into BetterC0de routing metadata", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "content.delta",
      eventId: "event-1",
      threadId: "thread-1",
      provider: "claudeAgent",
      providerInstanceId: "claude-main",
      streamKind: "assistant_text",
      delta: "hello",
    })

    expect(canonicalToLegacy(parsed)).toMatchObject({
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: {
        provider: "claudeAgent",
        providerKind: "claude",
        providerInstanceId: "claude-main",
      },
    })
  })

  it("normalizes providerKind driver slugs before legacy projection", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "content.delta",
      eventId: "event-claude-kind",
      threadId: "thread-1",
      providerKind: "claudeAgent",
      streamKind: "assistant_text",
      delta: "hello",
    })

    expect(canonicalToLegacy(parsed)).toMatchObject({
      payload: { providerKind: "claude" },
    })

    for (const providerKind of ["cursor", "BetterC0de"] as const) {
      const event = providerRuntimeEventSchema.parse({
        type: "content.delta",
        eventId: `event-${providerKind}`,
        threadId: "thread-1",
        providerKind,
        streamKind: "assistant_text",
        delta: "hello",
      })

      expect(canonicalToLegacy(event)).toMatchObject({
        payload: { providerKind },
      })
    }
  })

  it("accepts harness message.delta aliases as assistant content", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "message.delta",
      eventId: "event-message-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      delta: "Single turn response.\n",
    })

    expect(canonicalToLegacy(parsed)).toEqual({
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        delta: "Single turn response.\n",
        streamKind: "assistant_text",
        turn_id: "turn-1",
      },
    })
  })

  it("accepts and bridges canonical request payloads", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "request.opened",
      eventId: "event-request-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "request-1",
      payload: {
        requestType: "command_execution_approval",
        detail: "Run npm test",
        args: { command: "npm test" },
      },
    })

    expect(parsed).toMatchObject({
      type: "request.opened",
      requestId: "request-1",
      payload: {
        requestType: "command_execution_approval",
        detail: "Run npm test",
      },
    })

    expect(canonicalToLegacy(parsed)).toEqual({
      event_type: "tool_approval_requested",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        requestId: "request-1",
        requestType: "command_execution_approval",
        tool: "Run npm test",
        input: { command: "npm test" },
        detail: "Run npm test",
        event_id: "event-request-1",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "request.resolved",
        requestId: "request-1",
        turnId: "turn-1",
        payload: {
          requestType: "command_execution_approval",
          decision: "approve",
          resolution: { approved: true },
        },
      })
    ).toEqual({
      event_type: "tool_approval_resolved",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "request-1",
        decision: "approve",
        event_id: "event-1",
        turn_id: "turn-1",
        requestType: "command_execution_approval",
        resolution: { approved: true },
      },
    })
  })

  it("accepts harness approval.requested aliases", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "approval.requested",
      eventId: "event-approval-1",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "req-approval-1",
      requestKind: "command",
      detail: "Approve Claude tool call",
    })

    expect(canonicalToLegacy(parsed)).toEqual({
      event_type: "tool_approval_requested",
      thread_id: "thread-1",
      payload: {
        provider: "claudeAgent",
        providerKind: "claude",
        requestId: "req-approval-1",
        requestType: "command",
        tool: "Approve Claude tool call",
        input: {},
        detail: "Approve Claude tool call",
        event_id: "event-approval-1",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "approval.resolved",
        requestId: "req-approval-1",
        decision: "accept",
        turnId: "turn-1",
      })
    ).toEqual({
      event_type: "tool_approval_resolved",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "req-approval-1",
        decision: "accept",
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })
  })

  it("accepts and bridges canonical item lifecycle payloads", () => {
    const started = providerRuntimeEventSchema.parse({
      type: "item.started",
      eventId: "item-event-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payload: {
        itemType: "command_execution",
        title: "Run tests",
        detail: "npm test",
        data: { command: "npm test" },
      },
    })

    expect(canonicalToLegacy(started)).toEqual({
      event_type: "tool_call",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        tool_id: "item-1",
        tool_name: "Run tests",
        input: { command: "npm test" },
        itemType: "command_execution",
        title: "Run tests",
        detail: "npm test",
        data: { command: "npm test" },
        item: {
          itemType: "command_execution",
          title: "Run tests",
          detail: "npm test",
          data: { command: "npm test" },
        },
        started_at: 0,
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "item.completed",
        turnId: "turn-1",
        payload: {
          itemType: "command_execution",
          title: "Run tests",
          data: { stdout: "ok" },
        },
      })
    ).toMatchObject({
      event_type: "tool_result",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        tool_id: "event-1",
        tool_name: "Run tests",
        output: { stdout: "ok" },
        itemType: "command_execution",
        title: "Run tests",
        data: { stdout: "ok" },
        turn_id: "turn-1",
      },
    })
  })

  it("accepts and bridges payload-shaped content and reasoning deltas", () => {
    const assistantDelta = providerRuntimeEventSchema.parse({
      type: "content.delta",
      eventId: "content-event-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        streamKind: "assistant_text",
        delta: "hello",
        contentIndex: 0,
      },
    })
    const reasoningDelta = providerRuntimeEventSchema.parse({
      type: "content.delta",
      eventId: "reasoning-event-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        streamKind: "reasoning_text",
        delta: "thinking",
        summaryIndex: 0,
      },
    })

    expect(canonicalToLegacy(assistantDelta)).toEqual({
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        delta: "hello",
        streamKind: "assistant_text",
        turn_id: "turn-1",
      },
    })
    expect(canonicalToLegacy(reasoningDelta)).toEqual({
      event_type: "reasoning_delta",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        delta: "thinking",
        streamKind: "reasoning_text",
        turn_id: "turn-1",
      },
    })
  })

  it("accepts and bridges payload-shaped turn lifecycle events", () => {
    const started = providerRuntimeEventSchema.parse({
      type: "turn.started",
      eventId: "turn-event-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        model: "gpt-5.5",
        effort: "xhigh",
      },
    })
    const failed = providerRuntimeEventSchema.parse({
      type: "turn.completed",
      eventId: "turn-event-2",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        state: "failed",
        stopReason: "error",
        errorMessage: "model failed",
      },
    })

    expect(canonicalToLegacy(started)).toEqual({
      event_type: "turn_started",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        model: "gpt-5.5",
        effort: "xhigh",
        turn_id: "turn-1",
      },
    })
    expect(canonicalToLegacy(failed)).toEqual({
      event_type: "turn_error",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        state: "failed",
        stopReason: "error",
        errorMessage: "model failed",
        status: "failed",
        error: "model failed",
        turn_id: "turn-1",
      },
    })
  })

  it("preserves canonical turn diff event ids for provider-diff checkpoint placeholders", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "turn.diff.updated",
      eventId: "diff-event-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        unifiedDiff:
          "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
      },
    })

    expect(canonicalToLegacy(parsed)).toEqual({
      event_type: "turn.diff.updated",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        event_id: "diff-event-1",
        turn_id: "turn-1",
        unifiedDiff:
          "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
      },
    })
  })

  it("preserves provider instance and turn metadata for content events", () => {
    const legacy = canonicalToLegacy({
      ...base(),
      type: "content.delta",
      streamKind: "assistant_text",
      delta: "hello",
      turnId: "turn-1",
    })

    expect(legacy).toEqual({
      event_type: "content_delta",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        delta: "hello",
        streamKind: "assistant_text",
        turn_id: "turn-1",
      },
    })
  })

  it("bridges proposed-plan item ids for ingestion buffer parity", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "turn.proposed.delta",
        itemId: "plan-item-1",
        turnId: "turn-1",
        payload: { delta: "# Plan" },
      })
    ).toEqual({
      event_type: "turn.proposed.delta",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        delta: "# Plan",
        itemId: "plan-item-1",
        item_id: "plan-item-1",
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "turn.proposed.completed",
        itemId: "plan-item-1",
        turnId: "turn-1",
        payload: { planMarkdown: "# Plan" },
      })
    ).toEqual({
      event_type: "turn.proposed.completed",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        planMarkdown: "# Plan",
        itemId: "plan-item-1",
        item_id: "plan-item-1",
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "turn.proposed.completed",
        payload: { planMarkdown: "# Event fallback plan" },
      })
    ).toEqual({
      event_type: "turn.proposed.completed",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        planMarkdown: "# Event fallback plan",
        event_id: "event-1",
        turn_id: undefined,
      },
    })
  })

  it("preserves tool presentation seeds and routing metadata", () => {
    const legacy = canonicalToLegacy({
      ...base(),
      type: "tool.started",
      toolId: "tool-1",
      toolName: "shell",
      turnId: "turn-1",
      sessionId: "session-1",
      taskId: "task-1",
      agentId: "agent-1",
      parentAgentId: "agent-root",
      parentToolId: "tool-root",
      title: "Terminal",
      input: { command: "npm test" },
    })

    expect(legacy).toEqual({
      event_type: "tool_call",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        sessionId: "session-1",
        taskId: "task-1",
        agentId: "agent-1",
        parentAgentId: "agent-root",
        parentToolId: "tool-root",
        tool_id: "tool-1",
        tool_name: "shell",
        input: { command: "npm test" },
        title: "Terminal",
        started_at: 123,
        turn_id: "turn-1",
      },
    })
  })

  it("accepts harness tool lifecycle aliases without explicit tool ids", () => {
    const started = providerRuntimeEventSchema.parse({
      type: "tool.started",
      eventId: "tool-event-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      toolKind: "command",
      title: "Edit file",
      detail: "README.md",
    })
    const completed = providerRuntimeEventSchema.parse({
      type: "tool.completed",
      eventId: "tool-event-2",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      toolKind: "command",
      title: "Edit file",
      detail: "README.md",
    })

    expect(canonicalToLegacy(started)).toEqual({
      event_type: "tool_call",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        tool_id: "tool-event-1",
        tool_name: "Edit file",
        input: { detail: "README.md" },
        title: "Edit file",
        detail: "README.md",
        started_at: 0,
        turn_id: "turn-1",
      },
    })
    expect(canonicalToLegacy(completed)).toEqual({
      event_type: "tool_result",
      thread_id: "thread-1",
      payload: {
        provider: "codex",
        providerKind: "codex",
        tool_id: "tool-event-2",
        tool_name: "Edit file",
        output: { detail: "README.md" },
        title: "Edit file",
        detail: "README.md",
        completed_at: 0,
        turn_id: "turn-1",
      },
    })
  })

  it("bridges canonical tool denials without converting them to turn failures", () => {
    const denied = providerRuntimeEventSchema.parse({
      ...base(),
      type: "tool.denied",
      createdAt: "2026-05-11T10:00:00.000Z",
      turnId: "turn-1",
      payload: {
        toolName: "Edit",
        toolUseId: "tool-1",
        reason: "Path is outside the workspace",
        agentId: "agent-1",
      },
    })

    expect(canonicalToLegacy(denied)).toEqual({
      event_type: "tool.denied",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        toolName: "Edit",
        toolUseId: "tool-1",
        reason: "Path is outside the workspace",
        agentId: "agent-1",
        tool_id: "tool-1",
        tool_name: "Edit",
        event_id: "event-1",
        created_at: "2026-05-11T10:00:00.000Z",
        detail: "Path is outside the workspace",
        turn_id: "turn-1",
      },
    })
  })

  it("translates tool item lifecycle events without dropping turn ids", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "item.started",
        itemId: "read-1",
        kind: "tool:Read",
        turnId: "turn-1",
        payload: { file_path: "/tmp/app.ts" },
      })
    ).toEqual({
      event_type: "tool_call",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        tool_id: "read-1",
        tool_name: "Read",
        input: { file_path: "/tmp/app.ts" },
        item: { file_path: "/tmp/app.ts" },
        started_at: 123,
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "item.completed",
        itemId: "read-1",
        kind: "tool:Read",
        turnId: "turn-1",
        payload: "contents",
      })
    ).toEqual({
      event_type: "tool_result",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        tool_id: "read-1",
        tool_name: "Read",
        output: "contents",
        item: "contents",
        completed_at: 123,
        turn_id: "turn-1",
      },
    })
  })

  it("preserves non-tool assistant item completions for renderer finalization", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "item.completed",
        itemId: "assistant-1",
        turnId: "turn-1",
        payload: {
          itemType: "assistant_message",
          status: "completed",
          detail: "Final answer",
        },
      })
    ).toEqual({
      event_type: "item.completed",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        itemId: "assistant-1",
        kind: "assistant_message",
        itemType: "assistant_message",
        status: "completed",
        detail: "Final answer",
        item: {
          itemType: "assistant_message",
          status: "completed",
          detail: "Final answer",
        },
        turn_id: "turn-1",
      },
    })
  })

  it("preserves streamed tool input updates from item.updated events", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "item.updated",
        itemId: "grep-1",
        kind: "tool:Grep",
        turnId: "turn-1",
        payload: {
          itemType: "web_search",
          title: "Search",
          detail: "Grep: src",
          input: { pattern: "TODO", path: "src" },
          data: {
            toolName: "Grep",
            input: { pattern: "TODO", path: "src" },
          },
        },
      })
    ).toEqual({
      event_type: "tool_call_delta",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        tool_id: "grep-1",
        tool_name: "Grep",
        output_delta: "Grep: src",
        input: { pattern: "TODO", path: "src" },
        itemType: "web_search",
        title: "Search",
        detail: "Grep: src",
        data: {
          toolName: "Grep",
          input: { pattern: "TODO", path: "src" },
        },
        turn_id: "turn-1",
      },
    })
  })

  it("marks an item update that carries the whole output as cumulative", () => {
    // Codex `patchUpdated` puts the item's whole patch so far in `output`.
    // The bridge mirrors it into `output_delta` and marks the row so the
    // activity key and the renderer replace instead of appending, without
    // having to compare `detail` (the path list) against the patch.
    expect(
      canonicalToLegacy({
        ...base(),
        type: "item.updated",
        itemId: "patch-1",
        kind: "file_change",
        turnId: "turn-1",
        payload: {
          itemType: "file_change",
          title: "File change",
          detail: "src/app.ts",
          output: "diff --git a/src/app.ts b/src/app.ts\n+new\n",
          data: { changes: [{ path: "src/app.ts" }] },
        },
      })
    ).toMatchObject({
      event_type: "tool_call_delta",
      payload: {
        tool_id: "patch-1",
        output_delta: "diff --git a/src/app.ts b/src/app.ts\n+new\n",
        cumulative: true,
        detail: "src/app.ts",
      },
    })
    // An ACP-style update without `output` keeps the detail mirror and no
    // marker; the `detail === output_delta` rule still identifies it.
    const acpShaped = canonicalToLegacy({
      ...base(),
      type: "item.updated",
      itemId: "cmd-1",
      kind: "command_execution",
      payload: { itemType: "command_execution", detail: "npm test\nok" },
    })
    expect(acpShaped?.payload).toMatchObject({ output_delta: "npm test\nok" })
    expect(acpShaped?.payload).not.toHaveProperty("cumulative")
  })

  it("does not nest the item a second time under `item` on progress updates", () => {
    const legacy = canonicalToLegacy({
      ...base(),
      type: "item.updated",
      itemId: "cmd-1",
      kind: "tool:Bash",
      turnId: "turn-1",
      payload: {
        itemType: "command_execution",
        title: "Run-once-marker",
        detail: "npm test",
        data: { toolName: "Bash" },
      },
    })
    expect(legacy?.payload).not.toHaveProperty("item")
    // Before: the flattened title plus the whole item again under `item`.
    expect(JSON.stringify(legacy).match(/Run-once-marker/g)).toHaveLength(1)
  })

  it("keeps provider metadata on token usage and user input requests", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "token.usage",
        turnId: "turn-1",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: 4,
          cacheReadTokens: 3,
          cacheCreationTokens: 1,
          reasoningOutputTokens: 2,
          toolUses: 1,
          durationMs: 250,
          totalCostUsd: 0.0025,
          compactsAutomatically: true,
        },
      })
    ).toEqual({
      event_type: "token_usage",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        turn_id: "turn-1",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          usedTokens: 15,
          cachedInputTokens: 4,
          cacheReadTokens: 3,
          cacheCreationTokens: 1,
          reasoningOutputTokens: 2,
          toolUses: 1,
          durationMs: 250,
          totalCostUsd: 0.0025,
          compactsAutomatically: true,
        },
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "request.opened",
        requestId: "req-1",
        kind: "user_input",
        questions: [{ id: "framework", question: "Framework?" }],
      })
    ).toMatchObject({
      event_type: "user_input_requested",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "req-1",
        questions: [{ id: "framework", question: "Framework?" }],
      },
    })
  })

  it("bridges canonical user input events into legacy renderer events", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "request.opened",
        requestId: "req-1",
        kind: "user_input",
        turnId: "turn-1",
        questions: [{ id: "framework", question: "Framework?" }],
      })
    ).toEqual({
      event_type: "user_input_requested",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "req-1",
        questions: [{ id: "framework", question: "Framework?" }],
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "request.resolved",
        requestId: "req-1",
        decision: "answer",
        turnId: "turn-1",
      })
    ).toEqual({
      event_type: "user_input_resolved",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "req-1",
        decision: "answer",
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "user-input.requested",
        requestId: "req-1",
        turnId: "turn-1",
        payload: {
          questions: [{ id: "framework", question: "Framework?" }],
        },
      })
    ).toEqual({
      event_type: "user_input_requested",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "req-1",
        questions: [{ id: "framework", question: "Framework?" }],
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "user-input.resolved",
        requestId: "req-1",
        turnId: "turn-1",
        payload: {
          answers: { framework: "React" },
        },
      })
    ).toEqual({
      event_type: "user_input_resolved",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        requestId: "req-1",
        decision: "answer",
        answers: { framework: "React" },
        turn_id: "turn-1",
      },
    })
  })

  it("passes through task lifecycle events for activity ingestion", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "task.progress",
        turnId: "turn-1",
        payload: {
          taskId: "task-1",
          description: "Scanning files",
          summary: "Found provider runtime code",
          lastToolName: "grep",
        },
      })
    ).toEqual({
      event_type: "task.progress",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        turn_id: "turn-1",
        taskId: "task-1",
        description: "Scanning files",
        summary: "Found provider runtime code",
        lastToolName: "grep",
      },
    })
  })

  it("preserves scoped runtime warning and error metadata for ingestion guards", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "runtime.warning",
        turnId: "turn-1",
        message: "provider got slow",
        willRetry: true,
        detail: { latencyMs: 1500 },
      })
    ).toEqual({
      event_type: "turn_warning",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        error: "provider got slow",
        willRetry: true,
        event_id: "event-1",
        detail: { latencyMs: 1500 },
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "runtime.error",
        turnId: "turn-1",
        message: "provider failed",
        class: "transport_error",
        detail: { code: "ECONNRESET" },
      })
    ).toEqual({
      event_type: "turn_error",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        error: "provider failed",
        class: "transport_error",
        event_id: "event-1",
        detail: { code: "ECONNRESET" },
        turn_id: "turn-1",
      },
    })
  })

  it("bridges payload-shaped runtime warning and error events", () => {
    const warning = providerRuntimeEventSchema.parse({
      ...base(),
      type: "runtime.warning",
      turnId: "turn-1",
      payload: {
        message: "provider is retrying",
        detail: { attempt: 2 },
      },
    })
    const error = providerRuntimeEventSchema.parse({
      ...base(),
      type: "runtime.error",
      turnId: "turn-1",
      payload: {
        message: "permission denied",
        class: "permission_error",
        detail: { requestId: "req-1" },
      },
    })

    expect(canonicalToLegacy(warning)).toEqual({
      event_type: "turn_warning",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        error: "provider is retrying",
        willRetry: false,
        event_id: "event-1",
        detail: { attempt: 2 },
        turn_id: "turn-1",
      },
    })

    expect(canonicalToLegacy(error)).toEqual({
      event_type: "turn_error",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        error: "permission denied",
        class: "permission_error",
        event_id: "event-1",
        detail: { requestId: "req-1" },
        turn_id: "turn-1",
      },
    })
  })

  it("passes through runtime auxiliary events with legacy routing metadata", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "tool.progress",
        turnId: "turn-1",
        payload: {
          toolUseId: "tool-1",
          toolName: "grep",
          summary: "Searching files",
          elapsedSeconds: 1.5,
        },
      })
    ).toEqual({
      event_type: "tool.progress",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        toolUseId: "tool-1",
        toolName: "grep",
        summary: "Searching files",
        elapsedSeconds: 1.5,
        tool_id: "tool-1",
        tool_name: "grep",
        output_delta: "Searching files",
        turn_id: "turn-1",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "config.warning",
        turnId: "turn-1",
        payload: {
          summary: "Invalid config key",
          details: "Ignored deprecated option",
          path: ".codex/config.toml",
        },
      })
    ).toMatchObject({
      event_type: "config.warning",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        turn_id: "turn-1",
        summary: "Invalid config key",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "provider.metadata.changed",
        payload: {
          metadataKind: "skills",
          summary: "Skills changed",
        },
      })
    ).toMatchObject({
      event_type: "provider.metadata.changed",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        metadataKind: "skills",
        summary: "Skills changed",
      },
    })
  })

  it("passes through thread and plan events for activity ingestion", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "thread.token-usage.updated",
        payload: {
          usage: {
            usedTokens: 1200,
            maxTokens: 128000,
            inputTokens: 1000,
            outputTokens: 200,
          },
        },
      })
    ).toMatchObject({
      event_type: "thread.token-usage.updated",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        usage: {
          usedTokens: 1200,
        },
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "turn.plan.updated",
        turnId: "turn-1",
        payload: {
          explanation: "Plan",
          plan: [{ step: "Inspect", status: "completed" }],
        },
      })
    ).toMatchObject({
      event_type: "turn.plan.updated",
      thread_id: "thread-1",
      payload: {
        turn_id: "turn-1",
        plan: [{ step: "Inspect", status: "completed" }],
      },
    })
  })

  it("passes through session lifecycle events for activity ingestion", () => {
    expect(
      canonicalToLegacy(
        providerRuntimeEventSchema.parse({
          ...base(),
          type: "session.started",
          message: "top-level started",
        })
      )
    ).toEqual({
      event_type: "session.started",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        message: "top-level started",
        turn_id: undefined,
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "session.started",
        payload: {
          message: "started",
        },
      })
    ).toEqual({
      event_type: "session.started",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        message: "started",
        turn_id: undefined,
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "session.configured",
        payload: {
          config: { cwd: "/repo" },
        },
      })
    ).toMatchObject({
      event_type: "session.configured",
      payload: {
        config: { cwd: "/repo" },
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "session.state.changed",
        status: "waiting",
        reason: "top-level compacting",
      })
    ).toMatchObject({
      event_type: "session.state.changed",
      payload: {
        status: "waiting",
        state: "waiting",
        reason: "top-level compacting",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "session.state.changed",
        payload: {
          state: "waiting",
          reason: "status:compacting",
        },
      })
    ).toMatchObject({
      event_type: "session.state.changed",
      payload: {
        state: "waiting",
        reason: "status:compacting",
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "session.exited",
        reason: "window closed",
        exitKind: "graceful",
        recoverable: true,
      })
    ).toMatchObject({
      event_type: "session.exited",
      payload: {
        reason: "window closed",
        exitKind: "graceful",
        recoverable: true,
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "session.exited",
        payload: {
          exitKind: "graceful",
        },
      })
    ).toMatchObject({
      event_type: "session.exited",
      payload: {
        exitKind: "graceful",
      },
    })
  })

  it("passes through realtime events for broadcast and activity ingestion", () => {
    expect(
      canonicalToLegacy({
        ...base(),
        type: "thread.realtime.started",
        payload: {
          realtimeSessionId: "realtime-session-1",
        },
      })
    ).toEqual({
      event_type: "thread.realtime.started",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        realtimeSessionId: "realtime-session-1",
        turn_id: undefined,
      },
    })

    expect(
      canonicalToLegacy({
        ...base(),
        type: "thread.realtime.error",
        payload: {
          message: "Realtime failed",
        },
      })
    ).toMatchObject({
      event_type: "thread.realtime.error",
      thread_id: "thread-1",
      payload: {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        message: "Realtime failed",
      },
    })
  })

  it("bridges plan_approval requests and resolutions", () => {
    const opened = providerRuntimeEventSchema.parse({
      ...base(),
      providerKind: "claude",
      providerInstanceId: "claude-main",
      type: "request.opened",
      requestId: "req-plan-1",
      kind: "plan_approval",
      planMarkdown: "## Plan\n1. Do the thing",
      turnId: "turn-1",
    })
    expect(canonicalToLegacy(opened as ProviderRuntimeEvent)).toEqual({
      event_type: "plan_approval_requested",
      thread_id: "thread-1",
      payload: {
        providerKind: "claude",
        providerInstanceId: "claude-main",
        requestId: "req-plan-1",
        planMarkdown: "## Plan\n1. Do the thing",
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })

    const resolved = providerRuntimeEventSchema.parse({
      ...base(),
      providerKind: "claude",
      providerInstanceId: "claude-main",
      type: "request.resolved",
      requestId: "req-plan-1",
      requestKind: "plan_approval",
      decision: "approve",
      permissionMode: "acceptEdits",
      turnId: "turn-1",
    })
    expect(canonicalToLegacy(resolved as ProviderRuntimeEvent)).toEqual({
      event_type: "plan_approval_resolved",
      thread_id: "thread-1",
      payload: {
        providerKind: "claude",
        providerInstanceId: "claude-main",
        requestId: "req-plan-1",
        decision: "approve",
        requestKind: "plan_approval",
        permissionMode: "acceptEdits",
        event_id: "event-1",
        turn_id: "turn-1",
      },
    })
  })

  it("carries rich tool-approval context (title/description/suggestions) through request.opened", () => {
    const opened = providerRuntimeEventSchema.parse({
      ...base(),
      providerKind: "claude",
      providerInstanceId: "claude-main",
      type: "request.opened",
      requestId: "req-tool-1",
      kind: "tool_approval",
      tool: "Bash",
      input: { command: "rm -rf build" },
      title: "Claude wants to run rm -rf build",
      description: "Removes the build directory",
      decisionReason: "Matched ask rule",
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "rm:*" }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
      turnId: "turn-1",
    })
    expect(canonicalToLegacy(opened as ProviderRuntimeEvent)).toMatchObject({
      event_type: "tool_approval_requested",
      thread_id: "thread-1",
      payload: {
        requestId: "req-tool-1",
        tool: "Bash",
        input: { command: "rm -rf build" },
        title: "Claude wants to run rm -rf build",
        description: "Removes the build directory",
        decisionReason: "Matched ask rule",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "rm:*" }],
            behavior: "allow",
            destination: "localSettings",
          },
        ],
      },
    })
  })

  it("passes through pipeline lifecycle events for activity ingestion", () => {
    const runStarted = providerRuntimeEventSchema.parse({
      ...base(),
      providerKind: "betterc0de",
      providerInstanceId: "pipeline-runner",
      type: "pipeline.run.started",
      payload: {
        runId: "run-1",
        pipelineId: "plan-implement",
        pipelineName: "Plan → Implement",
        totalSteps: 2,
        userGoal: "Add dark mode",
      },
    })
    expect(canonicalToLegacy(runStarted as ProviderRuntimeEvent)).toEqual({
      event_type: "pipeline.run.started",
      thread_id: "thread-1",
      payload: {
        providerKind: "betterc0de",
        providerInstanceId: "pipeline-runner",
        runId: "run-1",
        pipelineId: "plan-implement",
        pipelineName: "Plan → Implement",
        totalSteps: 2,
        userGoal: "Add dark mode",
        turn_id: undefined,
      },
    })

    const stepCompleted = providerRuntimeEventSchema.parse({
      ...base(),
      providerKind: "betterc0de",
      type: "pipeline.step.completed",
      turnId: "turn-2",
      payload: {
        runId: "run-1",
        stepIndex: 0,
        stepId: "step-plan",
        stepName: "Plan",
        status: "completed",
        turnId: "turn-2",
        outputPreview: "## Plan",
      },
    })
    expect(
      canonicalToLegacy(stepCompleted as ProviderRuntimeEvent)
    ).toMatchObject({
      event_type: "pipeline.step.completed",
      thread_id: "thread-1",
      payload: {
        runId: "run-1",
        stepIndex: 0,
        stepId: "step-plan",
        status: "completed",
        turn_id: "turn-2",
      },
    })

    for (const [type, payload] of [
      [
        "pipeline.step.started",
        {
          runId: "run-1",
          stepIndex: 1,
          stepId: "step-implement",
          stepName: "Implement",
          totalSteps: 2,
        },
      ],
      [
        "pipeline.run.paused",
        { runId: "run-1", stepIndex: 1, reason: "stop_point" },
      ],
      ["pipeline.run.resumed", { runId: "run-1", stepIndex: 1 }],
      ["pipeline.run.completed", { runId: "run-1", status: "completed" }],
    ] as const) {
      const parsed = providerRuntimeEventSchema.parse({
        ...base(),
        providerKind: "betterc0de",
        type,
        payload,
      })
      expect(canonicalToLegacy(parsed as ProviderRuntimeEvent)).toMatchObject({
        event_type: type,
        thread_id: "thread-1",
        payload: expect.objectContaining({ runId: "run-1" }),
      })
    }
  })
})

/**
 * Golden table: one row per `case` arm of `canonicalToLegacy`, asserting the
 * exact legacy object (or `null`). This is the contract the bridge must keep
 * once it runs behind the journal instead of in front of it: the journal
 * stores the canonical event, and this table is what every stored event
 * must still translate to.
 */
describe("canonicalToLegacy golden table", () => {
  const routing = { providerKind: "codex", providerInstanceId: "codex-work" }
  const golden = (
    event: Record<string, unknown>
  ): ProviderRuntimeEvent =>
    ({ ...base(), ...event }) as unknown as ProviderRuntimeEvent

  const table: ReadonlyArray<{
    readonly name: string
    readonly event: ProviderRuntimeEvent
    readonly expected: ReturnType<typeof canonicalToLegacy>
  }> = [
    {
      name: "message.delta defaults to assistant text",
      event: golden({ type: "message.delta", turnId: "turn-1", delta: "hi" }),
      expected: {
        event_type: "content_delta",
        thread_id: "thread-1",
        payload: { ...routing, delta: "hi", streamKind: "assistant_text", turn_id: "turn-1" },
      },
    },
    {
      name: "content.delta assistant_text",
      event: golden({
        type: "content.delta",
        turnId: "turn-1",
        streamKind: "assistant_text",
        delta: "hi",
      }),
      expected: {
        event_type: "content_delta",
        thread_id: "thread-1",
        payload: { ...routing, delta: "hi", streamKind: "assistant_text", turn_id: "turn-1" },
      },
    },
    {
      name: "content.delta command_output stays a content delta",
      event: golden({
        type: "content.delta",
        turnId: "turn-1",
        streamKind: "command_output",
        delta: "$ ls",
      }),
      expected: {
        event_type: "content_delta",
        thread_id: "thread-1",
        payload: { ...routing, delta: "$ ls", streamKind: "command_output", turn_id: "turn-1" },
      },
    },
    {
      name: "content.delta reasoning_text becomes a reasoning delta",
      event: golden({
        type: "content.delta",
        turnId: "turn-1",
        streamKind: "reasoning_text",
        delta: "thinking",
      }),
      expected: {
        event_type: "reasoning_delta",
        thread_id: "thread-1",
        payload: { ...routing, delta: "thinking", streamKind: "reasoning_text", turn_id: "turn-1" },
      },
    },
    {
      name: "content.delta without a stream kind is declined",
      event: golden({ type: "content.delta", turnId: "turn-1", delta: "?" }),
      expected: null,
    },
    {
      name: "content.replace without a stream kind is assistant text",
      event: golden({ type: "content.replace", turnId: "turn-1", text: "final" }),
      expected: {
        event_type: "content_replace",
        thread_id: "thread-1",
        payload: { ...routing, text: "final", turn_id: "turn-1" },
      },
    },
    {
      name: "content.replace reasoning_summary_text becomes a reasoning replace",
      event: golden({
        type: "content.replace",
        turnId: "turn-1",
        streamKind: "reasoning_summary_text",
        text: "summary",
      }),
      expected: {
        event_type: "reasoning_replace",
        thread_id: "thread-1",
        payload: {
          ...routing,
          text: "summary",
          streamKind: "reasoning_summary_text",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "content.replace command_output is declined",
      event: golden({
        type: "content.replace",
        turnId: "turn-1",
        streamKind: "command_output",
        text: "x",
      }),
      expected: null,
    },
    {
      name: "reasoning.delta",
      event: golden({
        type: "reasoning.delta",
        turnId: "turn-1",
        streamKind: "reasoning_text",
        delta: "r",
      }),
      expected: {
        event_type: "reasoning_delta",
        thread_id: "thread-1",
        payload: { ...routing, delta: "r", streamKind: "reasoning_text", turn_id: "turn-1" },
      },
    },
    {
      name: "reasoning.replace",
      event: golden({
        type: "reasoning.replace",
        turnId: "turn-1",
        streamKind: "reasoning_text",
        text: "R",
      }),
      expected: {
        event_type: "reasoning_replace",
        thread_id: "thread-1",
        payload: { ...routing, text: "R", streamKind: "reasoning_text", turn_id: "turn-1" },
      },
    },
    {
      name: "turn.started spreads its payload",
      event: golden({
        type: "turn.started",
        turnId: "turn-1",
        payload: { model: "gpt-5.5", dispatchTurnId: "dispatch-1" },
      }),
      expected: {
        event_type: "turn_started",
        thread_id: "thread-1",
        payload: { ...routing, model: "gpt-5.5", dispatchTurnId: "dispatch-1", turn_id: "turn-1" },
      },
    },
    {
      name: "turn.completed completed",
      event: golden({
        type: "turn.completed",
        turnId: "turn-1",
        status: "completed",
        payload: { state: "completed", dispatchTurnId: "dispatch-1" },
      }),
      expected: {
        event_type: "turn_completed",
        thread_id: "thread-1",
        payload: {
          ...routing,
          state: "completed",
          dispatchTurnId: "dispatch-1",
          status: "completed",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "turn.completed interrupted",
      event: golden({
        type: "turn.completed",
        turnId: "turn-1",
        status: "interrupted",
        payload: { state: "interrupted" },
      }),
      expected: {
        event_type: "turn_interrupted",
        thread_id: "thread-1",
        payload: { ...routing, state: "interrupted", status: "interrupted", turn_id: "turn-1" },
      },
    },
    {
      name: "turn.completed payload state cancelled without a top-level status",
      event: golden({
        type: "turn.completed",
        turnId: "turn-1",
        payload: { state: "cancelled" },
      }),
      expected: {
        event_type: "turn_interrupted",
        thread_id: "thread-1",
        payload: { ...routing, state: "cancelled", status: "cancelled", turn_id: "turn-1" },
      },
    },
    {
      name: "turn.completed failed carries the error",
      event: golden({
        type: "turn.completed",
        turnId: "turn-1",
        status: "failed",
        error: "boom",
        payload: { state: "failed", errorMessage: "boom" },
      }),
      expected: {
        event_type: "turn_error",
        thread_id: "thread-1",
        payload: {
          ...routing,
          state: "failed",
          errorMessage: "boom",
          status: "failed",
          error: "boom",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "turn.completed failed without a message gets the default error",
      event: golden({
        type: "turn.completed",
        turnId: "turn-1",
        status: "failed",
        payload: { state: "failed" },
      }),
      expected: {
        event_type: "turn_error",
        thread_id: "thread-1",
        payload: {
          ...routing,
          state: "failed",
          status: "failed",
          error: "Turn failed",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "turn.completed with an unlisted state falls through to completed",
      event: golden({
        type: "turn.completed",
        turnId: "turn-1",
        payload: { state: "timed_out" },
      }),
      expected: {
        event_type: "turn_completed",
        thread_id: "thread-1",
        payload: { ...routing, state: "timed_out", status: "timed_out", turn_id: "turn-1" },
      },
    },
    {
      name: "token.usage renames totalTokens to usedTokens and keeps optional counters",
      event: golden({
        type: "token.usage",
        turnId: "turn-1",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: 2,
          cacheReadTokens: 1,
          cacheCreationTokens: 3,
          reasoningOutputTokens: 4,
          toolUses: 6,
          durationMs: 700,
          totalCostUsd: 0.01,
          compactsAutomatically: true,
        },
      }),
      expected: {
        event_type: "token_usage",
        thread_id: "thread-1",
        payload: {
          ...routing,
          turn_id: "turn-1",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            usedTokens: 15,
            cachedInputTokens: 2,
            cacheReadTokens: 1,
            cacheCreationTokens: 3,
            reasoningOutputTokens: 4,
            toolUses: 6,
            durationMs: 700,
            totalCostUsd: 0.01,
            compactsAutomatically: true,
          },
        },
      },
    },
    {
      name: "request.opened plan_approval",
      event: golden({
        type: "request.opened",
        turnId: "turn-1",
        requestId: "req-1",
        kind: "plan_approval",
        planMarkdown: "# Plan",
      }),
      expected: {
        event_type: "plan_approval_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-1",
          planMarkdown: "# Plan",
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "request.opened tool_approval with rich context",
      event: golden({
        type: "request.opened",
        turnId: "turn-1",
        requestId: "req-2",
        kind: "tool_approval",
        tool: "Bash",
        input: { command: "rm -rf build" },
        title: "Run command",
        description: "Deletes the build directory",
        decisionReason: "matches a deny rule",
        blockedPath: "/repo/build",
        suggestions: [
          {
            type: "setMode",
            mode: "acceptEdits",
            destination: "session",
          },
        ],
      }),
      expected: {
        event_type: "tool_approval_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-2",
          tool: "Bash",
          input: { command: "rm -rf build" },
          title: "Run command",
          description: "Deletes the build directory",
          decisionReason: "matches a deny rule",
          blockedPath: "/repo/build",
          suggestions: [
            { type: "setMode", mode: "acceptEdits", destination: "session" },
          ],
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "request.opened user_input",
      event: golden({
        type: "request.opened",
        turnId: "turn-1",
        requestId: "req-3",
        kind: "user_input",
        questions: [{ id: "q1", question: "Which branch?" }],
      }),
      expected: {
        event_type: "user_input_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-3",
          questions: [{ id: "q1", question: "Which branch?" }],
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "request.opened payload requestType tool_user_input is declined",
      event: golden({
        type: "request.opened",
        turnId: "turn-1",
        requestId: "req-4",
        payload: { requestType: "tool_user_input" },
      }),
      expected: null,
    },
    {
      name: "request.opened payload requestType becomes a tool approval",
      event: golden({
        type: "request.opened",
        turnId: "turn-1",
        requestId: "req-5",
        payload: {
          requestType: "exec_command_approval",
          detail: "git status",
          args: { command: "git status" },
        },
      }),
      expected: {
        event_type: "tool_approval_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-5",
          requestType: "exec_command_approval",
          tool: "git status",
          input: { command: "git status" },
          event_id: "event-1",
          turn_id: "turn-1",
          detail: "git status",
        },
      },
    },
    {
      name: "request.opened without kind or payload defaults to a user input request",
      event: golden({ type: "request.opened", turnId: "turn-1" }),
      expected: {
        event_type: "user_input_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "event-1",
          questions: [],
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "approval.requested",
      event: golden({
        type: "approval.requested",
        turnId: "turn-1",
        requestId: "approval-1",
        requestKind: "command",
        tool: "exec_command",
        input: { command: "git status" },
        detail: "git status",
      }),
      expected: {
        event_type: "tool_approval_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "approval-1",
          requestType: "command",
          tool: "exec_command",
          input: { command: "git status" },
          event_id: "event-1",
          turn_id: "turn-1",
          detail: "git status",
        },
      },
    },
    {
      name: "approval.resolved",
      event: golden({
        type: "approval.resolved",
        turnId: "turn-1",
        requestId: "approval-1",
        decision: "approve",
      }),
      expected: {
        event_type: "tool_approval_resolved",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "approval-1",
          decision: "approve",
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "request.resolved payload requestType tool_user_input is declined",
      event: golden({
        type: "request.resolved",
        requestId: "req-4",
        decision: "answer",
        payload: { requestType: "tool_user_input" },
      }),
      expected: null,
    },
    {
      name: "request.resolved plan_approval",
      event: golden({
        type: "request.resolved",
        turnId: "turn-1",
        requestId: "req-1",
        decision: "approve",
        requestKind: "plan_approval",
        permissionMode: "acceptEdits",
        message: "go ahead",
      }),
      expected: {
        event_type: "plan_approval_resolved",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-1",
          decision: "approve",
          requestKind: "plan_approval",
          permissionMode: "acceptEdits",
          message: "go ahead",
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "request.resolved answer becomes a user input resolution",
      event: golden({
        type: "request.resolved",
        turnId: "turn-1",
        requestId: "req-3",
        decision: "answer",
      }),
      expected: {
        event_type: "user_input_resolved",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-3",
          decision: "answer",
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "request.resolved approve keeps payload requestType and resolution",
      event: golden({
        type: "request.resolved",
        turnId: "turn-1",
        requestId: "req-5",
        decision: "approve",
        payload: { requestType: "exec_command_approval", resolution: "approved" },
      }),
      expected: {
        event_type: "tool_approval_resolved",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "req-5",
          decision: "approve",
          event_id: "event-1",
          turn_id: "turn-1",
          requestType: "exec_command_approval",
          resolution: "approved",
        },
      },
    },
    {
      name: "user-input.requested",
      event: golden({
        type: "user-input.requested",
        turnId: "turn-1",
        requestId: "ui-1",
        payload: { questions: [{ id: "q1", text: "Name?" }] },
      }),
      expected: {
        event_type: "user_input_requested",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "ui-1",
          questions: [{ id: "q1", text: "Name?" }],
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "user-input.resolved",
      event: golden({
        type: "user-input.resolved",
        turnId: "turn-1",
        requestId: "ui-1",
        payload: { answers: { q1: "main" } },
      }),
      expected: {
        event_type: "user_input_resolved",
        thread_id: "thread-1",
        payload: {
          ...routing,
          requestId: "ui-1",
          decision: "answer",
          answers: { q1: "main" },
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "session.started merges message and resume over the payload",
      event: golden({
        type: "session.started",
        message: "hello",
        resume: { sessionId: "s-1" },
        payload: { message: "ignored", resume: "ignored" },
      }),
      expected: {
        event_type: "session.started",
        thread_id: "thread-1",
        payload: {
          ...routing,
          message: "hello",
          resume: { sessionId: "s-1" },
          turn_id: undefined,
        },
      },
    },
    {
      name: "session.configured",
      event: golden({
        type: "session.configured",
        payload: { config: { model: "gpt-5.5" } },
      }),
      expected: {
        event_type: "session.configured",
        thread_id: "thread-1",
        payload: { ...routing, config: { model: "gpt-5.5" }, turn_id: undefined },
      },
    },
    {
      name: "session.exited lifts reason, recoverable and exitKind",
      event: golden({
        type: "session.exited",
        reason: "crash",
        recoverable: false,
        exitKind: "error",
        payload: { dispatchTurnId: "dispatch-1" },
      }),
      expected: {
        event_type: "session.exited",
        thread_id: "thread-1",
        payload: {
          ...routing,
          dispatchTurnId: "dispatch-1",
          reason: "crash",
          recoverable: false,
          exitKind: "error",
          turn_id: undefined,
        },
      },
    },
    {
      name: "session.state.changed prefers payload state and adds status when set",
      event: golden({
        type: "session.state.changed",
        status: "running",
        state: "ignored",
        reason: "turn",
        detail: { turn: 1 },
        payload: { state: "running" },
      }),
      expected: {
        event_type: "session.state.changed",
        thread_id: "thread-1",
        payload: {
          ...routing,
          reason: "turn",
          detail: { turn: 1 },
          status: "running",
          state: "running",
          turn_id: undefined,
        },
      },
    },
    {
      name: "session.state.changed without any state defaults to ready",
      event: golden({ type: "session.state.changed" }),
      expected: {
        event_type: "session.state.changed",
        thread_id: "thread-1",
        payload: { ...routing, state: "ready", turn_id: undefined },
      },
    },
    {
      name: "turn.diff.updated passes through with its event id",
      event: golden({
        type: "turn.diff.updated",
        turnId: "turn-1",
        payload: { unifiedDiff: "+x", files: [] },
      }),
      expected: {
        event_type: "turn.diff.updated",
        thread_id: "thread-1",
        payload: {
          ...routing,
          unifiedDiff: "+x",
          files: [],
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "turn.proposed.completed passes through with its event id",
      event: golden({
        type: "turn.proposed.completed",
        turnId: "turn-1",
        itemId: "plan-1",
        payload: { planMarkdown: "# P" },
      }),
      expected: {
        event_type: "turn.proposed.completed",
        thread_id: "thread-1",
        payload: {
          ...routing,
          planMarkdown: "# P",
          itemId: "plan-1",
          item_id: "plan-1",
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "turn.aborted passes through",
      event: golden({
        type: "turn.aborted",
        turnId: "turn-1",
        payload: { reason: "user interrupt", status: "interrupted", dispatchTurnId: "d-1" },
      }),
      expected: {
        event_type: "turn.aborted",
        thread_id: "thread-1",
        payload: {
          ...routing,
          reason: "user interrupt",
          status: "interrupted",
          dispatchTurnId: "d-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "item.updated tool snapshot with output is cumulative",
      event: golden({
        type: "item.updated",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "tool:exec_command",
        payload: {
          itemType: "command_execution",
          title: "Run",
          detail: "npm test",
          output: "all\n",
        },
      }),
      expected: {
        event_type: "tool_call_delta",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "item-1",
          tool_name: "exec_command",
          output_delta: "all\n",
          cumulative: true,
          itemType: "command_execution",
          title: "Run",
          detail: "npm test",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "item.updated tool progress without output mirrors detail and is not cumulative",
      event: golden({
        type: "item.updated",
        turnId: "turn-1",
        itemId: "item-1",
        payload: { itemType: "command_execution", detail: "partial", data: { pid: 4 } },
      }),
      expected: {
        event_type: "tool_call_delta",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "item-1",
          tool_name: "command_execution",
          output_delta: "partial",
          input: { pid: 4 },
          itemType: "command_execution",
          detail: "partial",
          data: { pid: 4 },
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "item.updated non-tool item keeps its envelope",
      event: golden({
        type: "item.updated",
        turnId: "turn-1",
        itemId: "item-9",
        kind: "assistant_message",
        payload: { itemType: "assistant_message", status: "running" },
      }),
      expected: {
        event_type: "item.updated",
        thread_id: "thread-1",
        payload: {
          ...routing,
          itemId: "item-9",
          kind: "assistant_message",
          itemType: "assistant_message",
          status: "running",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.progress",
      event: golden({
        type: "tool.progress",
        turnId: "turn-1",
        payload: { toolUseId: "tool-1", toolName: "Bash", summary: "running", elapsedSeconds: 2 },
      }),
      expected: {
        event_type: "tool.progress",
        thread_id: "thread-1",
        payload: {
          ...routing,
          toolUseId: "tool-1",
          toolName: "Bash",
          summary: "running",
          elapsedSeconds: 2,
          tool_id: "tool-1",
          tool_name: "Bash",
          output_delta: "running",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.started",
      event: golden({
        type: "tool.started",
        turnId: "turn-1",
        toolId: "tool-1",
        toolName: "exec_command",
        title: "Run tests",
        detail: "npm test",
        input: { command: "npm test" },
      }),
      expected: {
        event_type: "tool_call",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "tool-1",
          tool_name: "exec_command",
          input: { command: "npm test" },
          title: "Run tests",
          detail: "npm test",
          started_at: 123,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.started without input or ids falls back to the event id and detail",
      event: golden({ type: "tool.started", turnId: "turn-1", detail: "ls" }),
      expected: {
        event_type: "tool_call",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "event-1",
          tool_name: "tool",
          input: { detail: "ls" },
          detail: "ls",
          started_at: 123,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.delta",
      event: golden({
        type: "tool.delta",
        turnId: "turn-1",
        toolId: "tool-1",
        toolName: "exec_command",
        delta: "chunk",
        streamKind: "command_output",
      }),
      expected: {
        event_type: "tool_call_delta",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "tool-1",
          tool_name: "exec_command",
          output_delta: "chunk",
          streamKind: "command_output",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.completed",
      event: golden({
        type: "tool.completed",
        turnId: "turn-1",
        toolId: "tool-1",
        toolName: "exec_command",
        title: "Run tests",
        output: { stdout: "ok" },
      }),
      expected: {
        event_type: "tool_result",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "tool-1",
          tool_name: "exec_command",
          output: { stdout: "ok" },
          title: "Run tests",
          completed_at: 123,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.failed uses the error as output when none is given",
      event: golden({
        type: "tool.failed",
        turnId: "turn-1",
        toolId: "tool-2",
        toolName: "read_file",
        error: "ENOENT",
      }),
      expected: {
        event_type: "tool_result",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "tool-2",
          tool_name: "read_file",
          output: "ENOENT",
          error: "ENOENT",
          completed_at: 123,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "tool.denied",
      event: golden({
        type: "tool.denied",
        turnId: "turn-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        payload: { toolName: "rm", toolUseId: "tool-3", reason: "read-only" },
      }),
      expected: {
        event_type: "tool.denied",
        thread_id: "thread-1",
        payload: {
          ...routing,
          toolName: "rm",
          toolUseId: "tool-3",
          reason: "read-only",
          tool_id: "tool-3",
          tool_name: "rm",
          event_id: "event-1",
          created_at: "2026-01-01T00:00:00.000Z",
          detail: "read-only",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "item.started tool item nests the item and reads input from data",
      event: golden({
        type: "item.started",
        turnId: "turn-1",
        itemId: "item-2",
        kind: "tool:apply_patch",
        payload: {
          itemType: "file_change",
          title: "Edit a.ts",
          data: { input: { path: "a.ts" } },
        },
      }),
      expected: {
        event_type: "tool_call",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "item-2",
          tool_name: "apply_patch",
          input: { path: "a.ts" },
          itemType: "file_change",
          title: "Edit a.ts",
          data: { input: { path: "a.ts" } },
          item: {
            itemType: "file_change",
            title: "Edit a.ts",
            data: { input: { path: "a.ts" } },
          },
          started_at: 123,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "item.started non-tool item is declined",
      event: golden({
        type: "item.started",
        turnId: "turn-1",
        itemId: "item-4",
        kind: "assistant_message",
        payload: { itemType: "assistant_message" },
      }),
      expected: null,
    },
    {
      name: "item.completed tool item nests the item and reads output from data",
      event: golden({
        type: "item.completed",
        turnId: "turn-1",
        itemId: "item-2",
        kind: "tool:apply_patch",
        payload: {
          itemType: "file_change",
          status: "completed",
          data: { output: "patched" },
        },
      }),
      expected: {
        event_type: "tool_result",
        thread_id: "thread-1",
        payload: {
          ...routing,
          tool_id: "item-2",
          tool_name: "apply_patch",
          output: "patched",
          itemType: "file_change",
          data: { output: "patched" },
          item: {
            itemType: "file_change",
            status: "completed",
            data: { output: "patched" },
          },
          completed_at: 123,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "item.completed non-tool item keeps its envelope and nests the item",
      event: golden({
        type: "item.completed",
        turnId: "turn-1",
        itemId: "item-5",
        kind: "assistant_message",
        payload: { itemType: "assistant_message", status: "completed" },
      }),
      expected: {
        event_type: "item.completed",
        thread_id: "thread-1",
        payload: {
          ...routing,
          itemId: "item-5",
          kind: "assistant_message",
          itemType: "assistant_message",
          status: "completed",
          item: { itemType: "assistant_message", status: "completed" },
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "runtime.warning",
      event: golden({
        type: "runtime.warning",
        turnId: "turn-1",
        message: "slow",
        willRetry: true,
        detail: { attempt: 2 },
      }),
      expected: {
        event_type: "turn_warning",
        thread_id: "thread-1",
        payload: {
          ...routing,
          error: "slow",
          willRetry: true,
          event_id: "event-1",
          detail: { attempt: 2 },
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "runtime.error",
      event: golden({
        type: "runtime.error",
        turnId: "turn-1",
        message: "provider exploded",
        class: "provider_error",
      }),
      expected: {
        event_type: "turn_error",
        thread_id: "thread-1",
        payload: {
          ...routing,
          error: "provider exploded",
          class: "provider_error",
          event_id: "event-1",
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "provider driver and correlation ids are lifted into every legacy payload",
      event: golden({
        type: "tool.delta",
        provider: "claudeAgent",
        providerKind: undefined,
        providerInstanceId: "claude-main",
        turnId: "turn-1",
        toolId: "tool-1",
        delta: "x",
        sessionId: "session-1",
        taskId: "task-1",
        parentTaskId: "task-0",
        agentId: "agent-1",
        parentAgentId: "agent-0",
        parentEventId: "event-0",
        parentToolId: "tool-0",
      }),
      expected: {
        event_type: "tool_call_delta",
        thread_id: "thread-1",
        payload: {
          provider: "claudeAgent",
          providerKind: "claude",
          providerInstanceId: "claude-main",
          sessionId: "session-1",
          taskId: "task-1",
          parentTaskId: "task-0",
          agentId: "agent-1",
          parentAgentId: "agent-0",
          parentEventId: "event-0",
          parentToolId: "tool-0",
          tool_id: "tool-1",
          tool_name: undefined,
          output_delta: "x",
          streamKind: undefined,
          turn_id: "turn-1",
        },
      },
    },
    {
      name: "an unknown type is declined",
      event: golden({ type: "not.a.real.event", payload: {} }),
      expected: null,
    },
  ]

  it.each(table)("$name", ({ event, expected }) => {
    expect(canonicalToLegacy(event)).toEqual(expected)
  })

  it("passes every auxiliary event type through with routing metadata and turn id", () => {
    const passthrough = [
      "task.started",
      "task.progress",
      "task.completed",
      "hook.started",
      "hook.progress",
      "hook.completed",
      "pipeline.run.started",
      "pipeline.step.started",
      "pipeline.step.completed",
      "pipeline.run.paused",
      "pipeline.run.resumed",
      "pipeline.run.completed",
      "tool.summary",
      "auth.status",
      "account.updated",
      "account.rate-limits.updated",
      "mcp.status.updated",
      "mcp.oauth.completed",
      "model.rerouted",
      "config.warning",
      "provider.metadata.changed",
      "deprecation.notice",
      "files.persisted",
      "thread.started",
      "thread.state.changed",
      "thread.metadata.updated",
      "thread.token-usage.updated",
      "thread.realtime.started",
      "thread.realtime.item-added",
      "thread.realtime.audio.delta",
      "thread.realtime.error",
      "thread.realtime.closed",
      "turn.aborted",
      "turn.plan.updated",
      "turn.proposed.delta",
      "turn.proposed.completed",
      "turn.diff.updated",
    ] as const
    const withEventId = new Set<string>([
      "turn.diff.updated",
      "turn.proposed.delta",
      "turn.proposed.completed",
    ])
    for (const type of passthrough) {
      const legacy = canonicalToLegacy(
        golden({ type, turnId: "turn-1", itemId: "item-7", payload: { marker: type } })
      )
      expect(legacy, type).toEqual({
        event_type: type,
        thread_id: "thread-1",
        payload: {
          ...routing,
          marker: type,
          itemId: "item-7",
          item_id: "item-7",
          ...(withEventId.has(type) ? { event_id: "event-1" } : {}),
          turn_id: "turn-1",
        },
      })
    }
  })
})
