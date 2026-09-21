import path from "node:path"
import { describe, expect, it } from "vitest"
import type { ThreadActivity } from "@betterc0de/schema"
import { derivePendingApprovals } from "./pending-approvals"
import {
  describeRequestResponseFailure,
  failedRequestResponseActivity,
} from "./pending-provider-requests"

// The backend projection is loaded at runtime only. A static import would
// make the renderer's `tsc` (erasableSyntaxOnly) type-check the backend's
// persistence layer through a type-only import chain, which it rejects.
// Absolute path: vitest resolves a runtime-computed relative specifier
// against the project root, not this file.
const BACKEND_PROJECTION_MODULE = path
  .resolve(
    import.meta.dirname,
    "../../../backend/src/provider/activity-projection/index.ts"
  )
  .replace(/\\/g, "/")
type BackendProjection = {
  makeFailedRequestActivity: (input: {
    threadId: string
    requestId: string
    providerKind: string
    providerInstanceId?: string
    requestKind: "approval" | "user-input" | "plan-approval"
    detail: string
    sequence: number
  }) => { activity_id: string; kind: string; summary: string }
}
async function loadBackendProjection(): Promise<BackendProjection> {
  return (await import(
    /* @vite-ignore */ BACKEND_PROJECTION_MODULE
  )) as BackendProjection
}

const REQUESTED: ThreadActivity = {
  id: "thread-1::approval.requested::approval-1",
  threadId: "thread-1",
  kind: "approval.requested",
  tone: "info",
  summary: "Approval requested",
  payload: {
    requestId: "approval-1",
    providerKind: "claude",
    toolName: "Bash",
    input: { command: "rm -rf build" },
  },
  sequence: 1_000,
  createdAt: "2026-09-11T10:00:00.000Z",
}

describe("describeRequestResponseFailure", () => {
  it("prefers the thrown message and falls back for empty or non-error values", () => {
    expect(
      describeRequestResponseFailure(
        new Error("Provider approval response failed."),
        "fallback"
      )
    ).toBe("Provider approval response failed.")
    expect(describeRequestResponseFailure(new Error("   "), "fallback")).toBe(
      "fallback"
    )
    expect(describeRequestResponseFailure("plain text", "fallback")).toBe(
      "plain text"
    )
    expect(describeRequestResponseFailure(undefined, "fallback")).toBe(
      "fallback"
    )
    expect(describeRequestResponseFailure({ status: 502 }, "fallback")).toBe(
      "fallback"
    )
  })
})

describe("failedRequestResponseActivity", () => {
  it("mirrors the backend's failed-response activity shape", () => {
    const activity = failedRequestResponseActivity({
      threadId: "thread-1",
      requestId: "approval-1",
      providerKind: "claude",
      providerInstanceId: "claude-main",
      requestKind: "approval",
      detail: "Provider approval response failed.",
      now: Date.UTC(2026, 8, 11, 10, 0, 5),
    })

    expect(activity).toEqual({
      id: "thread-1::provider.approval.respond.failed::approval-1",
      threadId: "thread-1",
      kind: "provider.approval.respond.failed",
      tone: "error",
      summary: "Provider approval response failed",
      payload: {
        requestId: "approval-1",
        providerKind: "claude",
        providerInstanceId: "claude-main",
        detail: "Provider approval response failed.",
      },
      sequence: Date.UTC(2026, 8, 11, 10, 0, 5) * 1000,
      createdAt: "2026-09-11T10:00:05.000Z",
    })
  })

  // Twin parity (same pattern as `types/cjs-twin-parity.test.ts`): the
  // backend projection and this local twin must mint the same activity id,
  // or a retried response lands as a second row next to the first instead
  // of upserting it.
  it("mints the same id as the backend projection for the same failure", async () => {
    const { makeFailedRequestActivity } = await loadBackendProjection()
    const inputs = [
      {
        threadId: "thread-1",
        requestId: "approval-1",
        providerKind: "claude",
        providerInstanceId: "claude-main",
        requestKind: "approval" as const,
        detail: "Provider approval response failed.",
      },
      {
        threadId: "thread with spaces",
        requestId: "plan 1",
        providerKind: "codex",
        requestKind: "plan-approval" as const,
        detail: "Provider codex does not support plan approvals",
      },
    ]
    for (const input of inputs) {
      const local = failedRequestResponseActivity(input)
      // Two backend attempts at different sequences: one id.
      const first = makeFailedRequestActivity({ ...input, sequence: 101 })
      const retry = makeFailedRequestActivity({ ...input, sequence: 250 })
      expect(first.activity_id).toBe(retry.activity_id)
      expect(local.id, input.requestId).toBe(first.activity_id)
      expect(local.kind).toBe(first.kind)
      expect(local.summary).toBe(first.summary)
    }
  })

  it("labels plan approvals distinctly and tolerates a missing instance id", () => {
    const activity = failedRequestResponseActivity({
      threadId: "thread-1",
      requestId: "plan-1",
      providerKind: "codex",
      requestKind: "plan-approval",
      detail: "Provider codex does not support plan approvals",
    })
    expect(activity.summary).toBe("Provider plan-approval response failed")
    expect(activity.payload).toMatchObject({
      providerInstanceId: undefined,
      detail: "Provider codex does not support plan approvals",
    })
  })

  it("keeps a still-answerable request open but clears one the provider no longer knows", () => {
    // A transient refusal leaves the inline row so the user can retry ...
    const transient = failedRequestResponseActivity({
      threadId: "thread-1",
      requestId: "approval-1",
      providerKind: "claude",
      requestKind: "approval",
      detail: "Provider approval response failed.",
    })
    expect(
      derivePendingApprovals([REQUESTED, transient]).map((a) => a.requestId)
    ).toEqual(["approval-1"])

    // ... while a stale/unknown request is settled everywhere.
    const stale = failedRequestResponseActivity({
      threadId: "thread-1",
      requestId: "approval-1",
      providerKind: "claude",
      requestKind: "approval",
      detail: "unknown pending approval request approval-1",
    })
    expect(derivePendingApprovals([REQUESTED, stale])).toEqual([])
  })
})
