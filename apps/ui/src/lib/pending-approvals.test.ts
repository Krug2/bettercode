import { describe, expect, it } from "vitest"
import type { ThreadActivity } from "@/lib/chat-store"
import { derivePendingPlanApprovals } from "@/lib/pending-approvals"

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

describe("derivePendingPlanApprovals", () => {
  it("recovers plan text from the request's own turn when payload is empty", () => {
    const activities = [
      activity({
        id: "1",
        sequence: 1,
        turnId: "turn-1",
        kind: "turn.proposed.completed",
        payload: { planMarkdown: "# Real plan\nStep one" },
      }),
      activity({
        id: "2",
        sequence: 2,
        turnId: "turn-1",
        kind: "plan-approval.requested",
        payload: { requestId: "req-1", turn_id: "turn-1" },
      }),
    ]
    const [approval] = derivePendingPlanApprovals(activities)
    expect(approval?.planMarkdown).toBe("# Real plan\nStep one")
  })

  it("does not overwrite an open request with a later turn's proposal", () => {
    const activities = [
      activity({
        id: "1",
        sequence: 1,
        turnId: "turn-1",
        kind: "turn.proposed.completed",
        payload: { planMarkdown: "# Real plan" },
      }),
      activity({
        id: "2",
        sequence: 2,
        turnId: "turn-1",
        kind: "plan-approval.requested",
        payload: { requestId: "req-1", turn_id: "turn-1" },
      }),
      // A later turn proposes an unrelated follow-up while req-1 is still open.
      activity({
        id: "3",
        sequence: 3,
        turnId: "turn-2",
        kind: "turn.proposed.completed",
        payload: { planMarkdown: "Hey! Unrelated follow-up message" },
      }),
    ]
    const approval = derivePendingPlanApprovals(activities).find(
      (a) => a.requestId === "req-1"
    )
    expect(approval?.planMarkdown).toBe("# Real plan")
  })

  it("recovers the plan even when the request is sorted before its proposal", () => {
    // Out-of-order (session resume): request arrives before the proposal in
    // the log, but both share a turn — the backfill still matches by turn.
    const activities = [
      activity({
        id: "2",
        sequence: 1,
        turnId: "turn-1",
        kind: "plan-approval.requested",
        payload: { requestId: "req-1", turn_id: "turn-1" },
      }),
      activity({
        id: "1",
        sequence: 2,
        turnId: "turn-1",
        kind: "turn.proposed.completed",
        payload: { planMarkdown: "# Recovered plan" },
      }),
    ]
    const [approval] = derivePendingPlanApprovals(activities)
    expect(approval?.planMarkdown).toBe("# Recovered plan")
  })

  it("strips model preamble and an unclosed <proposed_plan> tag", () => {
    const activities = [
      activity({
        id: "1",
        sequence: 1,
        turnId: "turn-1",
        kind: "turn.proposed.completed",
        payload: {
          planMarkdown:
            "Here's the plan for review.\n<proposed_plan>\n## Add a toggle\nStep one",
        },
      }),
      activity({
        id: "2",
        sequence: 2,
        turnId: "turn-1",
        kind: "plan-approval.requested",
        payload: { requestId: "req-1", turn_id: "turn-1" },
      }),
    ]
    const [approval] = derivePendingPlanApprovals(activities)
    expect(approval?.planMarkdown).toBe("## Add a toggle\nStep one")
  })

  it("drops resolved plan approvals", () => {
    const activities = [
      activity({
        id: "1",
        sequence: 1,
        kind: "plan-approval.requested",
        payload: { requestId: "req-1", planMarkdown: "# Plan" },
      }),
      activity({
        id: "2",
        sequence: 2,
        kind: "plan-approval.resolved",
        payload: { requestId: "req-1" },
      }),
    ]
    expect(derivePendingPlanApprovals(activities)).toHaveLength(0)
  })
})
