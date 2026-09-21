import { describe, expect, it } from "vitest"
import type { PendingPlanApproval } from "@/lib/pending-approvals"
import { selectPlanApprovalForImplement } from "@/lib/plan-implement"

function approval(partial: Partial<PendingPlanApproval>): PendingPlanApproval {
  return {
    requestId: partial.requestId ?? "req",
    providerKind: partial.providerKind ?? "claude",
    planMarkdown: partial.planMarkdown ?? "# Plan",
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...(partial.providerInstanceId
      ? { providerInstanceId: partial.providerInstanceId }
      : {}),
    ...(partial.turnId ? { turnId: partial.turnId } : {}),
  }
}

describe("selectPlanApprovalForImplement", () => {
  it("returns null when nothing is pending", () => {
    expect(selectPlanApprovalForImplement([])).toBeNull()
  })

  it("prefers the approval for the plan's own turn", () => {
    const pending = [
      approval({ requestId: "a", turnId: "turn-1" }),
      approval({ requestId: "b", turnId: "turn-2" }),
    ]
    expect(selectPlanApprovalForImplement(pending, "turn-1")?.requestId).toBe("a")
  })

  it("falls back to the newest pending approval without a turn match", () => {
    const pending = [
      approval({ requestId: "a", turnId: "turn-1" }),
      approval({ requestId: "b", turnId: "turn-2" }),
    ]
    expect(selectPlanApprovalForImplement(pending, "turn-9")?.requestId).toBe(
      "b"
    )
    expect(selectPlanApprovalForImplement(pending)?.requestId).toBe("b")
  })
})
