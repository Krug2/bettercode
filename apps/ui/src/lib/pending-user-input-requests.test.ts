import { describe, expect, it } from "vitest"
import type { ThreadActivity } from "@/lib/chat-store"
import { derivePendingProviderUserInputs } from "@/lib/pending-user-input-requests"

function activity(partial: Partial<ThreadActivity>): ThreadActivity {
  return {
    id: partial.id ?? "a",
    threadId: partial.threadId ?? "t",
    turnId: partial.turnId ?? null,
    providerInstanceId: partial.providerInstanceId ?? null,
    kind: partial.kind ?? "info",
    tone: partial.tone ?? "info",
    summary: partial.summary ?? "",
    payload: partial.payload ?? {},
    sequence: partial.sequence ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
  }
}

function requested(
  requestId: string,
  sequence: number,
  createdAt: string
): ThreadActivity {
  return activity({
    id: `req-${requestId}`,
    kind: "user-input.requested",
    sequence,
    createdAt,
    payload: {
      providerKind: "claude",
      requestId,
      questions: [
        {
          question: "How should dark mode work on this page?",
          options: [{ label: "Toggle (light + dark)" }],
        },
      ],
    },
  })
}

function resolved(
  requestId: string,
  sequence: number,
  createdAt: string
): ThreadActivity {
  return activity({
    id: `res-${requestId}`,
    kind: "user-input.resolved",
    sequence,
    createdAt,
    payload: { providerKind: "claude", requestId, decision: "answer" },
  })
}

describe("derivePendingProviderUserInputs", () => {
  it("keeps an unanswered request open", () => {
    const pending = derivePendingProviderUserInputs([
      requested("r1", 200, "2026-08-21T10:00:00.000Z"),
    ])
    expect(pending).toHaveLength(1)
    expect(pending[0]?.requestId).toBe("r1")
    expect(pending[0]?.questions[0]?.text).toBe(
      "How should dark mode work on this page?"
    )
  })

  it("drops a request once it is answered", () => {
    const pending = derivePendingProviderUserInputs([
      requested("r1", 200, "2026-08-21T10:00:00.000Z"),
      resolved("r1", 300, "2026-08-21T10:01:00.000Z"),
    ])
    expect(pending).toEqual([])
  })

  // Regression: activity sequences come from two emitters — the provider
  // event projection stamps wall-clock time, while the HTTP routes used a
  // counter seeded at backend start. A resolution could therefore carry a
  // LOWER sequence than the request it answered, and sorting by sequence
  // replayed delete-then-open — so submitting an answer made the question
  // reappear instantly. Real observed values from a user's database.
  it("stays closed when the resolution has a lower sequence than the request", () => {
    const pending = derivePendingProviderUserInputs([
      requested("c4588465", 1784849975786312, "2026-07-24T02:18:05.984Z"),
      resolved("c4588465", 1784849975539001, "2026-07-24T02:19:30.526Z"),
    ])
    expect(pending).toEqual([])
  })

  it("stays closed regardless of the order activities arrive in", () => {
    const req = requested("r1", 999, "2026-08-21T10:00:00.000Z")
    const res = resolved("r1", 1, "2026-08-21T10:01:00.000Z")
    expect(derivePendingProviderUserInputs([req, res])).toEqual([])
    expect(derivePendingProviderUserInputs([res, req])).toEqual([])
  })

  it("settles a request whose response failed as stale", () => {
    const pending = derivePendingProviderUserInputs([
      requested("r1", 200, "2026-08-21T10:00:00.000Z"),
      activity({
        id: "fail-r1",
        kind: "provider.user-input.respond.failed",
        sequence: 5,
        createdAt: "2026-08-21T10:01:00.000Z",
        payload: {
          providerKind: "claude",
          requestId: "r1",
          detail: "Unknown pending user-input request r1",
        },
      }),
    ])
    expect(pending).toEqual([])
  })

  it("keeps other requests open when one is answered", () => {
    const pending = derivePendingProviderUserInputs([
      requested("r1", 100, "2026-08-21T10:00:00.000Z"),
      requested("r2", 200, "2026-08-21T10:00:30.000Z"),
      resolved("r1", 5, "2026-08-21T10:01:00.000Z"),
    ])
    expect(pending.map((entry) => entry.requestId)).toEqual(["r2"])
  })
})
