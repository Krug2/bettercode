import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  decisionSettingsSchema,
  emptyDecisionSnapshot,
  type DecisionRecord,
} from "@betterc0de/schema"
import { DecisionPanel } from "./decision-sidebar"
import { newerDecisionSnapshot } from "./use-decisions"

const record: DecisionRecord = {
  id: "one",
  threadId: "chat",
  kind: "route",
  status: "selected",
  mode: "local",
  model: "local-test",
  candidates: [{ id: "worker", label: "Quick worker" }],
  choice: "worker",
  confidence: null,
  reason: null,
  elapsedMs: 121,
  inputTokens: 10,
  outputTokens: 2,
  createdAt: "2026-09-24T00:00:00Z",
}
describe("live decision panel", () => {
  it("does not let a delayed initial fetch replace a newer live snapshot", () => {
    const current = {
      ...emptyDecisionSnapshot("chat"),
      revision: 4,
      records: [record],
    }
    expect(
      newerDecisionSnapshot(current, {
        ...emptyDecisionSnapshot("chat"),
        revision: 2,
      })
    ).toBe(current)
  })
  it("shows measured usage without inventing local confidence or savings", () => {
    const snapshot = {
      ...emptyDecisionSnapshot("chat"),
      revision: 1,
      records: [record],
      calls: 1,
      selected: 1,
      inputTokens: 10,
      outputTokens: 2,
      elapsedMs: 121,
    }
    const html = renderToStaticMarkup(
      <DecisionPanel
        snapshot={snapshot}
        settings={decisionSettingsSchema.parse({ mode: "local" })}
        connected
        error={null}
        onRetry={() => undefined}
      />
    )
    expect(html).toContain("Quick worker")
    expect(html).toContain("121 ms")
    expect(html).toContain("Reported tokens")
    expect(html).not.toContain("% confidence")
    expect(html).not.toContain("saved")
  })
  it("distinguishes disconnected activity from an active selector call", () => {
    const snapshot = {
      ...emptyDecisionSnapshot("chat"),
      records: [{ ...record, status: "deciding" as const }],
    }
    const html = renderToStaticMarkup(
      <DecisionPanel
        snapshot={snapshot}
        settings={decisionSettingsSchema.parse({ mode: "jev" })}
        connected={false}
        error={null}
        onRetry={() => undefined}
      />
    )
    expect(html).toContain("Reconnecting")
    expect(html).toContain("Awaiting reconnect")
    expect(html).not.toContain("Choosing the next step")
  })
})
