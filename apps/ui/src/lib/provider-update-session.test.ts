import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import { describe, expect, it } from "vitest"
import {
  createProviderUpdateSession,
  reduceProviderUpdateSession,
} from "./provider-update-session"

function snapshot(
  status: "running" | "succeeded" | "failed",
  finishedAt = "2026-09-14T12:00:02.000Z"
): ProviderInstanceSnapshot {
  return {
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    environment: [],
    config: {},
    configured: true,
    installed: true,
    version: "1.1.0",
    status: "ready",
    auth: { status: "authenticated" },
    availability: "available",
    checkedAt: "2026-09-14T12:00:00.000Z",
    models: [],
    providerCatalog: [],
    slashCommands: [],
    skills: [],
    agents: [],
    tools: [],
    updateState: {
      status,
      finishedAt,
      startedAt: null,
      message: null,
      output: null,
    },
  }
}

describe("provider update sidebar session", () => {
  it("does not schedule another render for unchanged or newly allocated empty snapshots", () => {
    const empty = createProviderUpdateSession([])
    expect(
      reduceProviderUpdateSession(empty, { type: "snapshot", providers: [] })
    ).toBe(empty)
    const providers = [snapshot("running")]
    const active = createProviderUpdateSession(providers)
    expect(
      reduceProviderUpdateSession(active, {
        type: "snapshot",
        providers: [...providers],
      })
    ).toBe(active)
  })

  it("waits for a real snapshot before establishing the cached-result cutoff", () => {
    const empty = createProviderUpdateSession([])
    expect(empty.since).toBeUndefined()
    const cached = reduceProviderUpdateSession(empty, {
      type: "snapshot",
      providers: [snapshot("succeeded", "2026-09-14T11:00:00Z")],
    })
    expect(cached.notice).toBeNull()
    const live = reduceProviderUpdateSession(cached, {
      type: "snapshot",
      providers: [snapshot("running")],
    })
    expect(live.notice?.tone).toBe("loading")
    expect(
      reduceProviderUpdateSession(live, {
        type: "snapshot",
        providers: [snapshot("succeeded")],
      }).notice?.tone
    ).toBe("success")
  })

  it("retains dismissals across polls but shows the next update result", () => {
    const result = createProviderUpdateSession([snapshot("failed")])
    const dismissed = reduceProviderUpdateSession(result, {
      type: "dismiss",
      key: result.notice!.key,
    })
    expect(dismissed.notice).toBeNull()
    expect(
      reduceProviderUpdateSession(dismissed, {
        type: "snapshot",
        providers: [snapshot("failed")],
      }).notice
    ).toBeNull()
    const next = reduceProviderUpdateSession(dismissed, {
      type: "snapshot",
      providers: [snapshot("failed", "2026-09-14T12:01:00Z")],
    })
    expect(next.notice?.tone).toBe("error")
  })

  it("ignores old timeout events and cannot dismiss a running update", () => {
    const first = createProviderUpdateSession([snapshot("succeeded")])
    const next = reduceProviderUpdateSession(first, {
      type: "snapshot",
      providers: [snapshot("failed", "2026-09-14T12:01:00Z")],
    })
    expect(
      reduceProviderUpdateSession(next, {
        type: "dismiss",
        key: first.notice!.key,
      })
    ).toBe(next)
    const running = createProviderUpdateSession([snapshot("running")])
    expect(
      reduceProviderUpdateSession(running, {
        type: "dismiss",
        key: running.notice!.key,
      })
    ).toBe(running)
  })

  it("uses timestamp values across timezones and retains the cutoff through disconnects", () => {
    const current = {
      ...snapshot("succeeded", "2026-09-14T14:00:02+02:00"),
      checkedAt: "2026-09-14T14:00:00+02:00",
    }
    const older = {
      ...snapshot("succeeded"),
      instanceId: "old",
      driver: "claude",
      checkedAt: "2026-09-14T13:30:00+03:00",
    }
    const first = createProviderUpdateSession([current, older])
    expect(first.since).toBe("2026-09-14T12:00:00.000Z")
    expect(first.notice?.tone).toBe("success")
    const empty = reduceProviderUpdateSession(first, {
      type: "snapshot",
      providers: [],
    })
    expect(empty.notice).toBeNull()
    expect(empty.since).toBe(first.since)
    expect(
      reduceProviderUpdateSession(empty, {
        type: "snapshot",
        providers: [current],
      }).notice?.tone
    ).toBe("success")
  })
})
