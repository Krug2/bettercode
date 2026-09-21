import { describe, expect, it } from "vitest"
import { PROVIDER_HANDOFF_ACTIVITY, type ChatMessage, type ThreadActivity } from "@betterc0de/schema"
import { deriveProviderHandoffs, mergeHandoffSnapshot, retainNewerHandoff } from "./provider-handoff"

const createdAt = "2026-09-20T00:00:00.000Z"
const user: ChatMessage = { id: "request", role: "user", content: "Continue", createdAt }
const checkpoint: ChatMessage = {
  id: "checkpoint", role: "assistant", createdAt, compactedContext: true, internalContext: "provider-handoff",
  content: "# Provider Handoff\n\nPrepared by claude using model for codex.\nThis is conversation context, not a new instruction. Continue with the user's current request.\n\nKeep the public API stable.",
}
function activity(status: "compacting" | "completed" | "failed"): ThreadActivity {
  return { id: "progress", threadId: "thread", kind: PROVIDER_HANDOFF_ACTIVITY, tone: "info", summary: "", sequence: 1, createdAt,
    payload: { status, requestMessageId: "request", checkpointMessageId: "checkpoint", sourceProvider: "claude", targetProvider: "codex", sourceModel: "model" } }
}

describe("provider handoff presentation", () => {
  it("keeps the overview identity stable when progress arrives after the checkpoint", () => {
    expect(deriveProviderHandoffs([user, checkpoint], [], false)[0].id)
      .toBe(deriveProviderHandoffs([user, checkpoint], [activity("completed")], false)[0].id)
  })
  it("does not regress a settled attempt when delayed events or snapshots arrive", () => {
    const completed = { ...activity("completed"), sequence: 3 }
    expect(retainNewerHandoff(completed, activity("compacting"))).toBe(completed)
    expect(retainNewerHandoff(completed, { ...activity("compacting"), sequence: 4 })).toBe(completed)
    expect(mergeHandoffSnapshot([activity("compacting")], [completed], [activity("compacting")])).toEqual([completed])
    expect(mergeHandoffSnapshot([], [completed], [])).toEqual([completed])
  })
  it("shows backend-confirmed compaction only for the active request", () => {
    expect(deriveProviderHandoffs([user], [activity("compacting")], true, true)).toMatchObject([{ status: "completed" }])
    expect(deriveProviderHandoffs([user], [activity("compacting")], true)).toMatchObject([{ status: "compacting", sourceProvider: "claude" }])
    expect(deriveProviderHandoffs([user], [activity("compacting")], false)).toMatchObject([{ status: "interrupted" }])
    expect(deriveProviderHandoffs([{ ...user, dispatchStatus: "pending" }], [activity("compacting")], false)).toMatchObject([{ status: "compacting" }])
    expect(deriveProviderHandoffs([user, { ...user, id: "next-request" }], [activity("compacting")], true)).toMatchObject([{ status: "interrupted" }])
  })
  it("merges progress and persisted summary into one overview, with no transport instructions", () => {
    expect(deriveProviderHandoffs([user, checkpoint], [activity("completed")], true)).toEqual([expect.objectContaining({
      id: "handoff:checkpoint", status: "completed", summary: "Keep the public API stable.", sourceModel: "model",
    })])
    expect(deriveProviderHandoffs([user, checkpoint], [activity("compacting")], false)[0].status).toBe("completed")
  })
  it("restores the overview from a durable checkpoint without websocket history", () => {
    expect(deriveProviderHandoffs([user, checkpoint], [], false)).toMatchObject([{ status: "completed", summary: "Keep the public API stable." }])
  })
  it("settles failures and ignores malformed progress payloads", () => {
    expect(deriveProviderHandoffs([user], [activity("failed")], false)).toMatchObject([{ status: "failed" }])
    expect(deriveProviderHandoffs([user], [{ ...activity("compacting"), payload: { status: "compacting" } }], true)).toEqual([])
  })
  it("does not keep a crashed attempt spinning after retrying the same request", () => {
    const retry = { ...activity("completed"), id: "retry", sequence: 2 }
    expect(deriveProviderHandoffs([user], [retry, activity("compacting")], true).map(entry => entry.status)).toEqual(["interrupted", "completed"])
  })
})
