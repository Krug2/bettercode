import { describe, expect, it } from "vitest"
import { mergeCanonicalRuntimeEventFields } from "@/lib/provider-runtime-event-fields"

describe("mergeCanonicalRuntimeEventFields", () => {
  it("keeps top-level lifecycle fields when the event also has a payload", () => {
    expect(
      mergeCanonicalRuntimeEventFields(
        { existing: true },
        {
          type: "session.state.changed",
          threadId: "thread-1",
          providerKind: "claude",
          providerInstanceId: "claude-work",
          eventId: "event-1",
          status: "error",
          reason: "transport closed",
          detail: { code: "EPIPE" },
          recoverable: true,
        }
      )
    ).toEqual({
      existing: true,
      providerKind: "claude",
      providerInstanceId: "claude-work",
      eventId: "event-1",
      status: "error",
      reason: "transport closed",
      detail: { code: "EPIPE" },
      recoverable: true,
    })
  })

  it("does not overwrite explicit nested payload values", () => {
    expect(
      mergeCanonicalRuntimeEventFields(
        { status: "ready", reason: "from payload", eventId: "payload-event" },
        {
          eventId: "top-event",
          status: "error",
          reason: "from envelope",
        }
      )
    ).toEqual({
      status: "ready",
      reason: "from payload",
      eventId: "payload-event",
    })
  })

  it("preserves canonical stream and tool fields from top-level envelopes", () => {
    expect(
      mergeCanonicalRuntimeEventFields(
        { streamKind: "assistant_text" },
        {
          type: "tool.delta",
          turnId: "turn-1",
          toolId: "tool-1",
          toolName: "exec_command",
          delta: "stdout",
          streamKind: "command_output",
        }
      )
    ).toEqual({
      streamKind: "assistant_text",
      turnId: "turn-1",
      toolId: "tool-1",
      toolName: "exec_command",
      delta: "stdout",
    })
  })

  it("preserves proposed-plan fields from top-level envelopes", () => {
    expect(
      mergeCanonicalRuntimeEventFields(
        { providerKind: "codex" },
        {
          type: "turn.proposed.completed",
          turnId: "turn-1",
          planId: "plan:thread-1:turn:turn-1",
          planMarkdown: "# Plan",
          implementationThreadId: "thread-implementation",
          implementedAt: "2026-05-11T10:05:00.000Z",
        }
      )
    ).toEqual({
      providerKind: "codex",
      turnId: "turn-1",
      planId: "plan:thread-1:turn:turn-1",
      planMarkdown: "# Plan",
      implementationThreadId: "thread-implementation",
      implementedAt: "2026-05-11T10:05:00.000Z",
    })
  })
})
