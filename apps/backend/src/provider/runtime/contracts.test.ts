import { describe, expect, it } from "vitest"
import {
  providerRefsSchema,
  providerRuntimeEventSchema,
  runtimeEventRawSchema,
  runtimeEventRawSourceSchema,
} from "./contracts"

const SUPPORTED_RAW_SOURCES = [
  "codex.app-server.notification",
  "codex.app-server.request",
  "codex.eventmsg",
  "claude.sdk.message",
  "claude.sdk.permission",
  "codex.sdk.thread-event",
  "BetterC0de.sdk.event",
  "acp.jsonrpc",
] as const

const CANONICAL_EVENT_FIXTURES: ReadonlyArray<{
  type: string
  payload: unknown
  extra?: Record<string, unknown>
}> = [
  { type: "session.started", payload: { message: "started" } },
  { type: "session.configured", payload: { config: {} } },
  { type: "session.state.changed", payload: { state: "waiting" } },
  {
    type: "session.exited",
    payload: { reason: "done", recoverable: false, exitKind: "graceful" },
  },
  { type: "thread.started", payload: { providerThreadId: "provider-thread" } },
  { type: "thread.state.changed", payload: { state: "idle", detail: {} } },
  {
    type: "thread.metadata.updated",
    payload: { name: "Thread", metadata: {} },
  },
  { type: "thread.token-usage.updated", payload: { usage: { usedTokens: 0 } } },
  { type: "thread.realtime.started", payload: { realtimeSessionId: "rt-1" } },
  { type: "thread.realtime.item-added", payload: { item: {} } },
  { type: "thread.realtime.audio.delta", payload: { audio: {} } },
  { type: "thread.realtime.error", payload: { message: "realtime failed" } },
  { type: "thread.realtime.closed", payload: { reason: "closed" } },
  {
    type: "turn.started",
    payload: { model: "gpt-5.5", effort: "xhigh" },
    extra: { turnId: "turn-1" },
  },
  {
    type: "turn.completed",
    payload: { state: "completed" },
    extra: { turnId: "turn-1" },
  },
  { type: "turn.aborted", payload: { reason: "stopped" } },
  {
    type: "turn.plan.updated",
    payload: {
      explanation: null,
      plan: [{ step: "Inspect provider runtime", status: "inProgress" }],
    },
  },
  { type: "turn.proposed.delta", payload: { delta: "partial plan" } },
  { type: "turn.proposed.completed", payload: { planMarkdown: "# Plan" } },
  { type: "turn.diff.updated", payload: { unifiedDiff: "diff --git a b" } },
  {
    type: "item.started",
    payload: {
      itemType: "command_execution",
      status: "inProgress",
      title: "Run command",
    },
  },
  {
    type: "item.updated",
    payload: {
      itemType: "command_execution",
      status: "inProgress",
      detail: "running",
    },
  },
  {
    type: "item.completed",
    payload: {
      itemType: "command_execution",
      status: "completed",
      data: {},
    },
  },
  {
    type: "tool.started",
    payload: {},
    extra: {
      turnId: "turn-1",
      toolKind: "command",
      title: "Edit file",
      detail: "README.md",
      sessionId: "session-1",
      taskId: "task-1",
      agentId: "agent-1",
      parentAgentId: "agent-root",
      parentToolId: "tool-root",
    },
  },
  {
    type: "tool.completed",
    payload: {},
    extra: {
      turnId: "turn-1",
      toolKind: "command",
      title: "Edit file",
      detail: "README.md",
    },
  },
  {
    type: "tool.denied",
    payload: {
      toolName: "Edit",
      toolUseId: "tool-1",
      reason: "Path is outside the workspace",
      agentId: "agent-1",
    },
    extra: { turnId: "turn-1" },
  },
  {
    type: "content.delta",
    payload: { streamKind: "plan_text", delta: "Plan line" },
  },
  {
    type: "message.delta",
    payload: { delta: "Assistant line" },
    extra: { turnId: "turn-1" },
  },
  {
    type: "request.opened",
    payload: { requestType: "tool_user_input", detail: "Need input" },
  },
  {
    type: "request.resolved",
    payload: { requestType: "tool_user_input", decision: "answer" },
  },
  {
    type: "approval.requested",
    payload: { requestKind: "command", detail: "Approve command" },
    extra: { requestId: "approval-1", turnId: "turn-1" },
  },
  {
    type: "approval.resolved",
    payload: { decision: "accept" },
    extra: { requestId: "approval-1", turnId: "turn-1" },
  },
  {
    type: "user-input.requested",
    payload: {
      questions: [
        {
          id: "q1",
          header: "Choice",
          question: "Continue?",
          options: [{ label: "Yes", description: "Proceed" }],
          multiSelect: false,
        },
      ],
    },
    extra: { requestId: "request-1" },
  },
  {
    type: "user-input.resolved",
    payload: { answers: { q1: "Yes" } },
    extra: { requestId: "request-1" },
  },
  { type: "task.started", payload: { taskId: "task-1" } },
  {
    type: "task.progress",
    payload: { taskId: "task-1", description: "Scanning" },
  },
  {
    type: "task.completed",
    payload: { taskId: "task-1", status: "completed" },
  },
  {
    type: "hook.started",
    payload: { hookId: "hook-1", hookName: "pre", hookEvent: "PreToolUse" },
  },
  { type: "hook.progress", payload: { hookId: "hook-1" } },
  { type: "hook.completed", payload: { hookId: "hook-1", outcome: "success" } },
  {
    type: "tool.progress",
    payload: { toolUseId: "tool-1", toolName: "bash", summary: "running" },
  },
  { type: "tool.summary", payload: { summary: "Command finished" } },
  { type: "auth.status", payload: { isAuthenticating: false, output: [] } },
  { type: "account.updated", payload: { account: {} } },
  { type: "account.rate-limits.updated", payload: { rateLimits: {} } },
  { type: "mcp.status.updated", payload: { status: {} } },
  { type: "mcp.oauth.completed", payload: { success: true, name: "server" } },
  {
    type: "model.rerouted",
    payload: { fromModel: "a", toModel: "b", reason: "fallback" },
  },
  { type: "config.warning", payload: { summary: "Config issue" } },
  { type: "deprecation.notice", payload: { summary: "Deprecated flag" } },
  {
    type: "files.persisted",
    payload: { files: [{ filename: "a.txt", fileId: "file-1" }] },
  },
  { type: "runtime.warning", payload: { message: "warned" } },
  { type: "runtime.error", payload: { message: "failed", class: "unknown" } },
]

describe("provider runtime contracts", () => {
  it("accepts every canonical runtime event type and payload shape", () => {
    for (const fixture of CANONICAL_EVENT_FIXTURES) {
      expect(
        providerRuntimeEventSchema.safeParse({
          type: fixture.type,
          threadId: "thread-1",
          eventId: `event-${fixture.type}`,
          provider: "codex",
          createdAt: "2026-02-28T00:00:00.000Z",
          payload: fixture.payload,
          ...fixture.extra,
        }).success,
        fixture.type
      ).toBe(true)
    }
  })

  it("validates and preserves canonical tool denial details", () => {
    expect(
      providerRuntimeEventSchema.parse({
        type: "tool.denied",
        threadId: "thread-1",
        turnId: "turn-1",
        eventId: "event-tool-denied",
        provider: "claudeAgent",
        createdAt: "2026-02-28T00:00:00.000Z",
        payload: {
          toolName: " Edit ",
          toolUseId: " tool-1 ",
          reason: " Path is outside the workspace ",
          agentId: " agent-1 ",
        },
      })
    ).toMatchObject({
      type: "tool.denied",
      payload: {
        toolName: "Edit",
        toolUseId: "tool-1",
        reason: "Path is outside the workspace",
        agentId: "agent-1",
      },
    })

    expect(
      providerRuntimeEventSchema.safeParse({
        type: "tool.denied",
        threadId: "thread-1",
        eventId: "event-tool-denied-invalid",
        payload: { toolName: " " },
      }).success
    ).toBe(false)
  })

  it("preserves Better checkpoint metadata on canonical turn diff payloads", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "turn.diff.updated",
      threadId: "thread-1",
      turnId: "turn-1",
      eventId: "event-turn-diff",
      provider: "codex",
      payload: {
        unifiedDiff: "diff --git a/a.txt b/a.txt",
        checkpointRef: "refs/betterc0de/checkpoints/thread/turn/1",
        turnIndex: 1,
        checkpointTurnCount: 1,
        diffTruncated: true,
        diffTruncationReason: "output_limit",
        diffFileCount: 32_493,
        diffFilesTruncated: true,
      },
    })

    expect(parsed).toMatchObject({
      payload: {
        checkpointRef: "refs/betterc0de/checkpoints/thread/turn/1",
        turnIndex: 1,
        checkpointTurnCount: 1,
        diffTruncated: true,
        diffTruncationReason: "output_limit",
        diffFileCount: 32_493,
        diffFilesTruncated: true,
      },
    })
  })

  it("accepts all supported named raw runtime sources", () => {
    for (const source of SUPPORTED_RAW_SOURCES) {
      expect(runtimeEventRawSourceSchema.parse(source)).toBe(source)
    }
  })

  it("accepts built-in provider driver slugs as provider kind metadata", () => {
    for (const providerKind of [
      "codex",
      "claudeAgent",
      "cursor",
      "BetterC0de",
    ] as const) {
      expect(
        providerRuntimeEventSchema.safeParse({
          type: "content.delta",
          threadId: "thread-1",
          eventId: `event-${providerKind}`,
          providerKind,
          streamKind: "assistant_text",
          delta: "hello",
        }).success,
        providerKind
      ).toBe(true)
    }
  })

  it("accepts ACP extension raw runtime sources", () => {
    expect(runtimeEventRawSourceSchema.parse("acp.vendor.extension")).toBe(
      "acp.vendor.extension"
    )
    expect(runtimeEventRawSourceSchema.parse("acp.vendor.tool.extension")).toBe(
      "acp.vendor.tool.extension"
    )
  })

  it("validates structured raw vendor envelopes on provider runtime events", () => {
    const parsed = providerRuntimeEventSchema.parse({
      type: "session.started",
      threadId: "thread-1",
      eventId: "event-1",
      raw: {
        source: "claude.sdk.message",
        method: " query ",
        messageType: " assistant ",
        payload: { type: "assistant", message: { id: "msg-1" } },
      },
    })

    expect(parsed.raw).toEqual({
      source: "claude.sdk.message",
      method: "query",
      messageType: "assistant",
      payload: { type: "assistant", message: { id: "msg-1" } },
    })
  })

  it("validates provider reference envelopes", () => {
    expect(
      providerRefsSchema.parse({
        providerTurnId: "turn-provider-1",
        providerItemId: "item-provider-1",
        providerRequestId: "request-provider-1",
      })
    ).toEqual({
      providerTurnId: "turn-provider-1",
      providerItemId: "item-provider-1",
      providerRequestId: "request-provider-1",
    })

    expect(
      providerRuntimeEventSchema.parse({
        type: "content.delta",
        threadId: "thread-1",
        eventId: "event-1",
        payload: {
          streamKind: "assistant_text",
          delta: "hello",
        },
        providerRefs: {
          providerTurnId: "turn-provider-1",
          providerItemId: "item-provider-1",
        },
      })
    ).toMatchObject({
      providerRefs: {
        providerTurnId: "turn-provider-1",
        providerItemId: "item-provider-1",
      },
    })
  })

  it("accepts payload-shaped runtime warnings and errors", () => {
    expect(
      providerRuntimeEventSchema.parse({
        type: "runtime.warning",
        threadId: "thread-1",
        eventId: "event-1",
        payload: {
          message: "provider is retrying",
          detail: { attempt: 2 },
        },
      })
    ).toMatchObject({
      type: "runtime.warning",
      willRetry: false,
      payload: {
        message: "provider is retrying",
        detail: { attempt: 2 },
      },
    })

    expect(
      providerRuntimeEventSchema.parse({
        type: "runtime.error",
        threadId: "thread-1",
        eventId: "event-2",
        payload: {
          message: "permission denied",
          class: "permission_error",
          detail: { requestId: "req-1" },
        },
      })
    ).toMatchObject({
      type: "runtime.error",
      payload: {
        message: "permission denied",
        class: "permission_error",
        detail: { requestId: "req-1" },
      },
    })
  })

  it("accepts BetterC0de content stream kinds", () => {
    for (const streamKind of ["plan_text", "unknown"] as const) {
      expect(
        providerRuntimeEventSchema.parse({
          type: "content.delta",
          threadId: "thread-1",
          eventId: `event-${streamKind}`,
          payload: {
            streamKind,
            delta: "partial text",
          },
        })
      ).toMatchObject({
        type: "content.delta",
        payload: {
          streamKind,
          delta: "partial text",
        },
      })
    }
  })

  it("rejects malformed raw runtime envelopes instead of accepting unknown blobs", () => {
    expect(
      runtimeEventRawSchema.safeParse({
        source: "random.sdk.message",
        payload: {},
      }).success
    ).toBe(false)
    expect(
      providerRuntimeEventSchema.safeParse({
        type: "session.started",
        threadId: "thread-1",
        eventId: "event-1",
        raw: { source: "codex.eventmsg" },
      }).success
    ).toBe(false)
  })
})
