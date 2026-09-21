import { describe, expect, it } from "vitest"
import {
  normalizeProviderGoal,
} from "@/lib/thread-goal"

describe("normalizeProviderGoal", () => {
  const nativeGoal = {
    threadId: "native-thread", objective: "Finish migration", status: "active",
    createdAt: 1_789_400_000, updatedAt: 1_789_400_150,
    tokensUsed: 1_234, tokenBudget: 20_000, timeUsedSeconds: 85,
  }

  it("reads native Codex goal notifications, accounting, and timestamps", () => {
    expect(normalizeProviderGoal({ goal: nativeGoal }, null, "codex")).toEqual({
      objective: "Finish migration", status: "active",
      startedAt: 1_789_400_000_000, updatedAt: 1_789_400_150_000,
      tokens: 1_234, tokenBudget: 20_000, timeUsedSeconds: 85, providerKind: "codex",
    })
  })

  it.each([
    ["active", "active"], ["paused", "paused"], ["complete", "achieved"],
    ["blocked", "blocked"], ["usageLimited", "usageLimited"],
    ["budgetLimited", "budgetLimited"], ["futureStatus", "unknown"],
  ])("preserves %s without inventing progress or completion", (status, expected) => {
    expect(normalizeProviderGoal({ ...nativeGoal, status }, null, "codex")?.status).toBe(expected)
  })

  it("clears wrapped empty goals and preserves an explicitly removed budget", () => {
    const previous = normalizeProviderGoal(nativeGoal, null, "codex")
    expect(normalizeProviderGoal({ goal: null }, previous, "codex")).toBeNull()
    expect(normalizeProviderGoal({ ...nativeGoal, tokenBudget: null }, previous, "codex")?.tokenBudget).toBeNull()
  })

  it("retains same-goal accounting during edits but never inherits it into a replacement", () => {
    const previous = normalizeProviderGoal(nativeGoal, null, "codex")
    expect(normalizeProviderGoal({
      objective: "Revised objective", createdAt: nativeGoal.createdAt,
    }, previous, "codex")).toMatchObject({ tokens: 1234, tokenBudget: 20000, status: "active" })
    const replacement = normalizeProviderGoal({
      objective: "New goal", status: "active", createdAt: nativeGoal.createdAt + 60,
    }, previous, "codex")
    expect(replacement).not.toHaveProperty("tokens")
    expect(replacement).not.toHaveProperty("tokenBudget")
    expect(replacement).not.toHaveProperty("timeUsedSeconds")
  })

  it("ignores malformed metadata and does not default unknown states to active", () => {
    expect(normalizeProviderGoal([], null, "codex")).toBeUndefined()
    expect(normalizeProviderGoal({}, null, "codex")).toBeUndefined()
    const unknown = normalizeProviderGoal({
      objective: "No confirmed status", tokensUsed: -10, timeUsedSeconds: NaN,
    }, null, "codex")
    expect(unknown?.status).toBe("unknown")
    expect(unknown).not.toHaveProperty("tokens")
    expect(unknown).not.toHaveProperty("timeUsedSeconds")
  })

  it("normalizes Codex goal metadata aliases", () => {
    expect(
      normalizeProviderGoal(
        {
          objective: "Finish migration",
          status: "running",
          started_at: "2026-07-23T10:00:00.000Z",
          turn_count: 4,
          tokens_used: 1234,
          last_reason: "Two call sites remain",
        },
        null,
        "codex"
      )
    ).toMatchObject({
      objective: "Finish migration",
      status: "active",
      startedAt: Date.parse("2026-07-23T10:00:00.000Z"),
      turns: 4,
      tokens: 1234,
      lastReason: "Two call sites remain",
      providerKind: "codex",
    })
  })

  it("clears the mirrored goal when the provider clears it", () => {
    expect(normalizeProviderGoal(null, null, "codex")).toBeNull()
  })

  it("never borrows another provider's objective for a partial update", () => {
    const previous = normalizeProviderGoal(nativeGoal, null, "codex")
    expect(normalizeProviderGoal({ status: "active" }, previous, "claude")).toBeUndefined()
    expect(normalizeProviderGoal({ goal: [] }, previous, "codex")).toBeUndefined()
    expect(normalizeProviderGoal({ goal: "malformed" }, previous, "codex")).toBeUndefined()
  })
})
