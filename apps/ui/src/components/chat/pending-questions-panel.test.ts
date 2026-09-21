import { describe, expect, it } from "vitest"
import type { ThreadActivity } from "@/lib/chat-store"
import { derivePendingProviderUserInputs } from "@/components/chat/pending-questions-panel"

function activity(input: Partial<ThreadActivity> & Pick<ThreadActivity, "kind">): ThreadActivity {
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

describe("derivePendingProviderUserInputs", () => {
  it("clears stale provider user-input requests after response failures", () => {
    const pending = derivePendingProviderUserInputs([
      activity({
        id: "user-input-open",
        kind: "user-input.requested",
        tone: "approval",
        sequence: 1,
        payload: {
          requestId: "question-1",
          providerKind: "claude",
          questions: [
            {
              id: "scope",
              question: "What should be planned?",
              options: [{ label: "Hero", description: "Hero section" }],
            },
          ],
        },
      }),
      activity({
        id: "user-input-stale",
        kind: "provider.user-input.respond.failed",
        tone: "error",
        sequence: 2,
        payload: {
          requestId: "question-1",
          detail:
            "Unknown pending user-input request: question-1. Provider callback state does not survive app restarts.",
        },
      }),
    ])

    expect(pending).toEqual([])
  })

  it("keeps provider user-input requests open for non-stale response failures", () => {
    const pending = derivePendingProviderUserInputs([
      activity({
        id: "user-input-open",
        kind: "user-input.requested",
        tone: "approval",
        sequence: 1,
        payload: {
          requestId: "question-1",
          providerKind: "claude",
          questions: [
            {
              id: "scope",
              question: "What should be planned?",
              options: [{ label: "Hero", description: "Hero section" }],
            },
          ],
        },
      }),
      activity({
        id: "user-input-failed",
        kind: "provider.user-input.respond.failed",
        tone: "error",
        sequence: 2,
        payload: {
          requestId: "question-1",
          detail: "No active provider session is bound to this thread.",
        },
      }),
    ])

    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ requestId: "question-1" })
  })
})
