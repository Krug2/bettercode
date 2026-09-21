import { describe, expect, it } from "vitest"
import type { ChatMessage, ThreadActivity } from "@/lib/chat-store"
import {
  deriveActivityWorkEntry,
  derivePendingApprovals,
  deriveTranscriptTimeline,
} from "@/components/chat/chat-transcript"

function activity(
  input: Partial<ThreadActivity> & Pick<ThreadActivity, "kind">
): ThreadActivity {
  return {
    id: input.id ?? `${input.kind}-1`,
    threadId: input.threadId ?? "thread-1",
    turnId: input.turnId ?? "turn-1",
    kind: input.kind,
    tone: input.tone ?? "info",
    summary: input.summary ?? "Activity",
    payload: input.payload ?? {},
    sequence: input.sequence ?? 1,
    createdAt: input.createdAt ?? "2026-05-11T10:00:00.000Z",
  }
}

describe("deriveActivityWorkEntry", () => {
  it("presents safe runtime diagnostics rather than a generic event name", () => {
    expect(deriveActivityWorkEntry(activity({ kind: "runtime.error", tone: "error", summary: "Provider runtime error", payload: { class: "transport_error", willRetry: false, message: "private diagnostic" } }))).toMatchObject({
      label: "Connection to provider failed",
      detail: expect.stringContaining("will not retry automatically"),
    })
  })
  it("keeps task started events as inspectable tree roots", () => {
    expect(
      deriveActivityWorkEntry(activity({ kind: "task.started" }))
    ).toMatchObject({
      kind: "task.started",
      label: "Activity",
      tone: "info",
    })
  })

  it("uses task progress payload summary as the visible label", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "task.progress",
          summary: "Reasoning update",
          payload: {
            summary: "Searching provider runtime code",
            lastToolName: "grep",
          },
        })
      )
    ).toMatchObject({
      label: "Searching provider runtime code",
      detail: "Last tool: grep",
      tone: "info",
    })
  })

  it("uses provider driver slugs when deriving provider labels", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "task.progress",
          payload: {
            provider: "claudeAgent",
            providerInstanceId: "claude-main",
            summary: "Reading files",
          },
        })
      )
    ).toMatchObject({
      providerKind: "claude",
      providerInstanceId: "claude-main",
      providerLabel: "Claude CLI / claude-main",
    })
  })

  it("uses task completed detail and preserves error tone", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "task.completed",
          tone: "error",
          summary: "Task failed",
          payload: { detail: "Failed to apply changes", status: "failed" },
        })
      )
    ).toMatchObject({
      label: "Failed to apply changes",
      detail: "failed",
      tone: "error",
    })
  })

  it("renders auxiliary runtime activities as work entries", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "config.warning",
          summary: "Invalid config key",
          payload: {
            detail: "Ignored deprecated option",
          },
        })
      )
    ).toMatchObject({
      label: "Invalid config key",
      detail: "Ignored deprecated option",
      tone: "info",
    })

    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "tool.updated",
          summary: "Searching files",
        })
      )
    ).toBeNull()
  })

  it("renders tool denials as error work entries with their reason", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "tool.denied",
          tone: "error",
          summary: "Tool denied: Edit",
          payload: {
            providerKind: "claude",
            providerInstanceId: "claude-main",
            toolName: "Edit",
            detail: "Path is outside the workspace",
          },
        })
      )
    ).toMatchObject({
      label: "Tool denied: Edit",
      detail: "Path is outside the workspace",
      providerKind: "claude",
      providerInstanceId: "claude-main",
      providerLabel: "Claude CLI / claude-main",
      kind: "tool.denied",
      tone: "error",
    })
  })

  it("renders plan and context activities as work entries", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "turn.plan.updated",
          summary: "Plan updated",
          payload: {
            detail: "Inspect files",
          },
        })
      )
    ).toMatchObject({
      label: "Plan updated",
      detail: "Inspect files",
    })

    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "context-compaction",
          summary: "Context compacted",
        })
      )
    ).toMatchObject({
      label: "Context compacted",
    })
  })

  it("keeps provider labels on visible work entries", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "runtime.warning",
          summary: "Provider warning",
          payload: {
            providerKind: "claude",
            providerInstanceId: "claude-max",
            message: "Rate limit soon",
          },
        })
      )
    ).toMatchObject({
      label: "Rate limit soon",
      providerLabel: "Claude CLI / claude-max",
    })
  })

  it("omits proposed-plan activities from generic work rows", () => {
    expect(
      deriveActivityWorkEntry(
        activity({
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan" },
        })
      )
    ).toBeNull()
  })
})

describe("deriveTranscriptTimeline", () => {
  it("hides internal handoff messages without removing ordinary messages or changing their indices", () => {
    const createdAt = "2026-09-19T22:00:00.000Z"
    const entries = deriveTranscriptTimeline([
      { id: "user", role: "user", content: "Continue", createdAt },
      { id: "command", role: "user", content: "Internal command", createdAt, internalContext: "provider-handoff" },
      { id: "summary", role: "assistant", content: "Private checkpoint", createdAt, compactedContext: true, internalContext: "provider-handoff" },
      { id: "answer", role: "assistant", content: "Hello", createdAt: "2026-09-19T22:00:01.000Z" },
    ], [])
    expect(entries.filter(entry => entry.kind === "message")).toMatchObject([{ id: "user", idx: 0 }, { id: "answer", idx: 3 }])
    expect(entries.filter(entry => entry.kind === "context-handoff")).toMatchObject([{ status: "completed", summary: "Private checkpoint" }])
  })

  it("hides legacy handoff pairs while preserving manual compaction and unpaired user text", () => {
    const createdAt = "2026-09-19T22:00:00.000Z"
    const entries = deriveTranscriptTimeline([
      { id: "command", role: "user", content: "Provider handoff: codex → claude", createdAt },
      { id: "summary", role: "assistant", content: "# Provider Handoff\n\nPrepared by codex using model for claude.\nContext", createdAt, compactedContext: true },
      { id: "manual", role: "assistant", content: "# Context Summary", createdAt, compactedContext: true },
      { id: "ordinary", role: "user", content: "Provider handoff: codex → claude", createdAt: "2026-09-19T22:00:01.000Z" },
    ], [])
    expect(entries.filter(entry => entry.kind === "message").map(entry => entry.id)).toEqual(["manual", "ordinary"])
    expect(entries.filter(entry => entry.kind === "context-handoff")).toHaveLength(1)
  })

  it("keeps persisted model switches in chronological transcript order", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "user-1",
          role: "user",
          content: "Continue",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "model-switch-1",
          kind: "session.model.switched",
          summary: "Model switched",
          createdAt: "2026-05-11T10:00:02.000Z",
          payload: {
            fromModelId: "gpt-5.6-sol",
            toModelId: "gpt-5.6-luna",
          },
        }),
      ]
    )

    expect(entries).toMatchObject([
      {
        kind: "model-switch",
        id: "model-switch-1",
        from: "gpt-5.6-sol",
        to: "gpt-5.6-luna",
      },
      {
        kind: "message",
        id: "user-1",
      },
    ])
  })

  it("puts inferred switches before the user, including the return to an earlier model", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "First", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "a1", role: "assistant", content: "One", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:01.000Z" },
      { id: "u2", role: "user", content: "Next", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:02.000Z" },
      { id: "a2", role: "assistant", content: "Two", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:03.000Z" },
      { id: "u3", role: "user", content: "Return", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:04.000Z" },
    ]
    expect(deriveTranscriptTimeline(messages, []).map(entry => entry.id)).toEqual([
      "u1", "a1", "model-switch:u2", "u2", "a2", "model-switch:u3", "u3",
    ])
    // Persisting the answer must not move an already visible divider.
    expect(deriveTranscriptTimeline(messages.slice(0, 3), []).map(entry => entry.id)).toEqual([
      "u1", "a1", "model-switch:u2", "u2",
    ])
  })

  it("anchors a delayed saved switch before its user and deduplicates inference", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", content: "Previous", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "u2", role: "user", content: "Continue", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:01.000Z" },
      { id: "a2", role: "assistant", content: "Answer", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:03.000Z" },
    ]
    const switchEvent = activity({ id: "saved-switch", kind: "session.model.switched", createdAt: "2026-09-20T10:00:02.000Z", payload: { fromModelId: "grok-4.6", toModelId: "claude-opus-5" } })
    expect(deriveTranscriptTimeline(messages, [switchEvent]).map(entry => entry.id)).toEqual([
      "a1", "saved-switch", "u2", "a2",
    ])
  })

  it("uses the answer's model for legacy user messages without a model", () => {
    expect(deriveTranscriptTimeline([
      { id: "a1", role: "assistant", content: "Previous", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "u2", role: "user", content: "Continue", createdAt: "2026-09-20T10:00:01.000Z" },
      { id: "a2", role: "assistant", content: "Answer", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:02.000Z" },
    ], []).map(entry => entry.id)).toEqual(["a1", "model-switch:u2", "u2", "a2"])
  })

  it("keeps a selection made during a response outside that response's turn", () => {
    expect(deriveTranscriptTimeline([
      { id: "u1", role: "user", content: "First", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "a1", role: "assistant", content: "Answer", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:02.000Z" },
      { id: "u2", role: "user", content: "Next", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:03.000Z" },
    ], [activity({ id: "selection", kind: "session.model.switched", createdAt: "2026-09-20T10:00:01.000Z", payload: { fromModelId: "grok-4.6", toModelId: "claude-opus-5" } })]).map(entry => entry.id)).toEqual([
      "u1", "a1", "selection", "u2",
    ])
  })

  it("preserves message order when a user and answer have identical timestamps", () => {
    expect(deriveTranscriptTimeline([
      { id: "z-user", role: "user", content: "Hi", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "a-answer", role: "assistant", content: "Hello", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:00.000Z" },
    ], []).map(entry => entry.id)).toEqual(["z-user", "a-answer"])
  })

  it("defers the next model selection until the in-flight answer is finished", () => {
    const entries = deriveTranscriptTimeline([
      { id: "u1", role: "user", content: "First", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:00.000Z" },
    ], [activity({ id: "selection", kind: "session.model.switched", createdAt: "2026-09-20T10:00:01.000Z", payload: { fromModelId: "grok-4.6", toModelId: "claude-opus-5" } })], { isStreaming: true })
    expect(entries.map(entry => entry.id)).toEqual(["u1"])
  })

  it("keeps the switch before the user and compaction together with the answer", () => {
    const entries = deriveTranscriptTimeline([
      { id: "a1", role: "assistant", content: "Previous", modelId: "grok-4.6", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "u2", role: "user", content: "Continue", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:01.000Z" },
      { id: "command", role: "user", content: "Provider handoff: grok_cli → claude", createdAt: "2026-09-20T10:00:02.000Z" },
      { id: "summary", role: "assistant", content: "# Provider Handoff\n\nPrepared by grok_cli using grok-4.6 for claude.\nContext", modelId: "grok-4.6", compactedContext: true, createdAt: "2026-09-20T10:00:02.000Z" },
      { id: "a2", role: "assistant", content: "Answer", modelId: "claude-opus-5", createdAt: "2026-09-20T10:00:03.000Z" },
    ], [])
    expect(entries.map(entry => entry.kind)).toEqual(["message", "model-switch", "message", "context-handoff", "message"])
    expect(entries.filter(entry => entry.kind === "model-switch")).toMatchObject([{ from: "grok-4.6", to: "claude-opus-5" }])
  })

  it("hides task progress work entries when session progress is disabled", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Working",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "progress-1",
          kind: "task.progress",
          summary: "Searching files",
          sequence: 1,
        }),
        activity({
          id: "completed-1",
          kind: "task.completed",
          summary: "Done",
          sequence: 2,
        }),
      ],
      { showSessionProgressBar: false }
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    expect(messageEntry?.work.map((entry) => entry.kind)).toEqual([
      "task.completed",
    ])
  })

  it("renders completed proposed plans as dedicated timeline entries", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
      ]
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: "proposed-plan",
      id: "plan-activity",
      content: "# Plan\n\n- step 1",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-activity",
      },
      implemented: false,
    })
  })

  it("uses the proposed-plan payload id as the implementation source id", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "activity-plan-row",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: {
            planId: "plan:thread-1:turn:turn-plan",
            planMarkdown: "# Plan\n\n- step 1",
          },
        }),
        activity({
          id: "plan-implemented",
          kind: "turn.proposed.implemented",
          turnId: null,
          summary: "Plan implemented",
          payload: {
            sourceProposedPlan: {
              threadId: "thread-1",
              planId: "plan:thread-1:turn:turn-plan",
            },
            implementationThreadId: "thread-implementation",
            implementedAt: "2026-05-11T10:05:00.000Z",
          },
        }),
      ]
    )

    expect(entries[0]).toMatchObject({
      kind: "proposed-plan",
      id: "activity-plan-row",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan:thread-1:turn:turn-plan",
      },
      implemented: true,
      implementationThreadId: "thread-implementation",
    })
  })

  it("omits ExitPlanMode lifecycle tools from proposed plan cards", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "exit-plan-started",
          kind: "tool.started",
          summary: "ExitPlanMode",
          payload: {
            toolId: "exit-plan-1",
            toolName: "ExitPlanMode",
            input: { plan: "# Plan\n\n- step 1" },
          },
        }),
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
      ]
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe("proposed-plan")
    if (entries[0]?.kind !== "proposed-plan") {
      throw new Error("expected proposed plan entry")
    }
    expect(entries[0].tools).toEqual([])
  })

  it("marks proposed plans implemented from source plan activities", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
        activity({
          id: "plan-implemented",
          kind: "turn.proposed.implemented",
          turnId: null,
          summary: "Plan implemented",
          payload: {
            sourceProposedPlan: {
              threadId: "thread-1",
              planId: "plan-activity",
            },
            implementationThreadId: "thread-implementation",
            implementedAt: "2026-05-11T10:05:00.000Z",
          },
        }),
      ]
    )

    expect(entries[0]).toMatchObject({
      kind: "proposed-plan",
      id: "plan-activity",
      implemented: true,
      implementationThreadId: "thread-implementation",
      implementedAt: "2026-05-11T10:05:00.000Z",
    })
  })

  it("hides the plan card on a plan message that duplicates its activity", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content:
            "Here's the plan.\n<proposed_plan>\n# Plan\n\n- step 1\n</proposed_plan>",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
      ]
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    expect(messageEntry).toMatchObject({ hidePlanCard: true })
    expect(
      entries.filter((entry) => entry.kind === "proposed-plan")
    ).toHaveLength(1)
  })

  it("keeps the plan card on a plan message with no matching activity", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "<proposed_plan>\n# Plan\n\n- step 1\n</proposed_plan>",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      []
    )

    expect(entries.find((entry) => entry.kind === "message")).toMatchObject({
      hidePlanCard: false,
    })
  })

  it("matches a plan message to its activity by text when the turn is missing", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "<proposed_plan>\n#   PLAN\n\n-   Step 1\n</proposed_plan>",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
      ]
    )

    expect(entries.find((entry) => entry.kind === "message")).toMatchObject({
      hidePlanCard: true,
    })
  })

  it("keeps both cards when the plan texts differ", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content:
            "<proposed_plan>\n# Other plan\n\n- step 9\n</proposed_plan>",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "plan-activity",
          turnId: "turn-2",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
      ]
    )

    expect(entries.find((entry) => entry.kind === "message")).toMatchObject({
      hidePlanCard: false,
    })
  })

  it("renders the turn tool group once when a plan message is suppressed", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "<proposed_plan>\n# Plan\n\n- step 1\n</proposed_plan>",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "tool-started",
          kind: "tool.started",
          summary: "Read",
          payload: { toolId: "tool-1", toolName: "Read", input: {} },
        }),
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
      ]
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    const planEntry = entries.find((entry) => entry.kind === "proposed-plan")
    expect(messageEntry?.tools).toEqual([])
    expect(planEntry?.tools).toHaveLength(1)
  })

  it("marks a proposed plan awaiting approval while its request is open", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
        activity({
          id: "plan-approval",
          kind: "plan-approval.requested",
          summary: "Plan approval requested",
          sequence: 2,
          payload: {
            requestId: "req-1",
            planMarkdown: "# Plan\n\n- step 1",
          },
        }),
      ]
    )

    expect(
      entries.find((entry) => entry.kind === "proposed-plan")
    ).toMatchObject({ awaitingApproval: true })
  })

  it("clears awaiting approval once the request resolves", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
        activity({
          id: "plan-approval",
          kind: "plan-approval.requested",
          summary: "Plan approval requested",
          sequence: 2,
          payload: { requestId: "req-1", planMarkdown: "# Plan\n\n- step 1" },
        }),
        activity({
          id: "plan-approval-resolved",
          kind: "plan-approval.resolved",
          summary: "Plan approved",
          sequence: 3,
          payload: { requestId: "req-1", decision: "approve" },
        }),
      ]
    )

    expect(
      entries.find((entry) => entry.kind === "proposed-plan")
    ).toMatchObject({ awaitingApproval: false })
  })

  it("marks awaiting approval when the request carries no plan text", () => {
    const entries = deriveTranscriptTimeline(
      [],
      [
        activity({
          id: "plan-activity",
          kind: "turn.proposed.completed",
          summary: "Plan proposed",
          payload: { planMarkdown: "# Plan\n\n- step 1" },
        }),
        activity({
          id: "plan-approval",
          kind: "plan-approval.requested",
          summary: "Plan approval requested",
          sequence: 2,
          payload: { requestId: "req-1" },
        }),
      ]
    )

    expect(
      entries.find((entry) => entry.kind === "proposed-plan")
    ).toMatchObject({ awaitingApproval: true })
  })

  it("rebuilds streamed tool input updates from persisted activities", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "tool-started",
          kind: "tool.started",
          tone: "tool",
          summary: "Search",
          sequence: 1,
          payload: {
            toolId: "tool-grep-1",
            toolName: "Grep",
            input: {},
          },
        }),
        activity({
          id: "tool-updated",
          kind: "tool.updated",
          tone: "tool",
          summary: "Search",
          sequence: 2,
          payload: {
            toolId: "tool-grep-1",
            toolName: "Grep",
            input: { pattern: "TODO", path: "src" },
            item: {
              data: {
                input: { pattern: "ignored", path: "fallback" },
              },
            },
          },
        }),
      ]
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    expect(messageEntry?.tools).toHaveLength(1)
    expect(messageEntry?.tools[0]).toMatchObject({
      id: "tool-grep-1",
      name: "Grep",
      input: { pattern: "TODO", path: "src" },
    })
  })

  it("preserves provider fields when rebuilding tools from persisted activities", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "tool-started",
          kind: "tool.started",
          tone: "tool",
          summary: "Search",
          sequence: 1,
          payload: {
            toolId: "tool-grep-1",
            toolName: "Grep",
            provider_kind: "codex_cli",
            provider_instance_id: "codex-work",
            input: { pattern: "TODO" },
          },
        }),
      ]
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    expect(messageEntry?.tools[0]).toMatchObject({
      providerKind: "codex",
      providerInstanceId: "codex-work",
    })
  })

  it("collapses legacy tool lifecycle rows when completed metadata has no tool id", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:03.000Z",
        },
      ],
      [
        activity({
          id: "legacy-read-update",
          kind: "tool.updated",
          tone: "tool",
          summary: "Read File",
          sequence: 1,
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read File",
            detail: 'Read: {"file_path":"/tmp/app.ts"}',
          },
        }),
        activity({
          id: "legacy-read-complete",
          kind: "tool.completed",
          tone: "tool",
          summary: "Read File",
          sequence: 2,
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read File",
            detail: 'Read: {"file_path":"/tmp/app.ts"}',
          },
        }),
      ]
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    expect(messageEntry?.tools).toHaveLength(1)
    expect(messageEntry?.tools[0]).toMatchObject({
      id: "legacy-read-update",
      name: "Read File",
      state: "output-available",
    })
  })

  it("keeps later identical legacy tool calls separate after the first one completed", () => {
    const entries = deriveTranscriptTimeline(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          turnId: "turn-1",
          createdAt: "2026-05-11T10:00:05.000Z",
        },
      ],
      [
        activity({
          id: "tool-1-update",
          kind: "tool.updated",
          tone: "tool",
          summary: "Read File",
          sequence: 1,
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read File",
            detail: 'Read: {"file_path":"/tmp/app.ts"}',
          },
        }),
        activity({
          id: "tool-1-complete",
          kind: "tool.completed",
          tone: "tool",
          summary: "Read File",
          sequence: 2,
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read File",
            detail: 'Read: {"file_path":"/tmp/app.ts"}',
          },
        }),
        activity({
          id: "tool-2-update",
          kind: "tool.updated",
          tone: "tool",
          summary: "Read File",
          sequence: 3,
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read File",
            detail: 'Read: {"file_path":"/tmp/app.ts"}',
          },
        }),
        activity({
          id: "tool-2-complete",
          kind: "tool.completed",
          tone: "tool",
          summary: "Read File",
          sequence: 4,
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read File",
            detail: 'Read: {"file_path":"/tmp/app.ts"}',
          },
        }),
      ]
    )

    const messageEntry = entries.find((entry) => entry.kind === "message")
    expect(messageEntry?.tools.map((tool) => tool.id)).toEqual([
      "tool-1-update",
      "tool-2-update",
    ])
  })
})

describe("derivePendingApprovals", () => {
  it("clears stale approval requests after provider response failures", () => {
    const pending = derivePendingApprovals([
      activity({
        id: "approval-open",
        kind: "approval.requested",
        tone: "approval",
        sequence: 1,
        payload: {
          requestId: "approval-1",
          providerKind: "claude",
          toolName: "Bash",
        },
      }),
      activity({
        id: "approval-stale",
        kind: "provider.approval.respond.failed",
        tone: "error",
        sequence: 2,
        payload: {
          requestId: "approval-1",
          detail:
            "Stale pending approval request: approval-1. Provider callback state does not survive app restarts.",
        },
      }),
    ])

    expect(pending).toEqual([])
  })

  it("keeps approval requests open for non-stale response failures", () => {
    const pending = derivePendingApprovals([
      activity({
        id: "approval-open",
        kind: "approval.requested",
        tone: "approval",
        sequence: 1,
        payload: {
          requestId: "approval-1",
          providerKind: "claude",
          toolName: "Bash",
        },
      }),
      activity({
        id: "approval-failed",
        kind: "provider.approval.respond.failed",
        tone: "error",
        sequence: 2,
        payload: {
          requestId: "approval-1",
          detail: "No active provider session is bound to this thread.",
        },
      }),
    ])

    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ requestId: "approval-1" })
  })
})
