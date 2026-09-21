import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import {
  PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY,
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  collectUpdatedProviderSnapshots,
  dismissProviderUpdateNotification,
  firstRejectedProviderUpdateMessage,
  getProviderUpdateInitialView,
  getProviderUpdateProgressView,
  getProviderUpdateSidebarPillView,
  getSingleProviderUpdateProgressView,
  hasOneClickUpdateProviderCandidate,
  isProviderUpdateCandidate,
  isProviderUpdateNotificationDismissed,
  providerUpdateNotificationKey,
  type ProviderUpdateCandidate,
} from "@/lib/provider-update-notification"

const checkedAt = "2026-04-23T10:00:00.000Z"
const laterCheckedAt = "2026-04-23T10:01:00.000Z"

function provider(input: {
  readonly driver: string
  readonly instanceId?: string
  readonly enabled?: boolean
  readonly version?: string | null
  readonly latestVersion?: string | null
  readonly canUpdate?: boolean
  readonly updateCommand?: string | null
  readonly updateState?: ProviderInstanceSnapshot["updateState"]
  readonly advisoryStatus?: NonNullable<
    ProviderInstanceSnapshot["versionAdvisory"]
  >["status"]
  readonly checkedAt?: string
}): ProviderInstanceSnapshot {
  const snapshot: ProviderInstanceSnapshot = {
    instanceId: input.instanceId ?? input.driver,
    driver: input.driver,
    displayName: input.driver,
    enabled: input.enabled ?? true,
    environment: [],
    config: {},
    configured: true,
    installed: true,
    version: input.version ?? "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: input.checkedAt ?? checkedAt,
    availability: "available",
    models: [],
    providerCatalog: [],
    slashCommands: [],
    skills: [],
    agents: [],
    tools: [],
    versionAdvisory: {
      status: input.advisoryStatus ?? "behind_latest",
      currentVersion: input.version ?? "1.0.0",
      latestVersion:
        "latestVersion" in input ? (input.latestVersion ?? null) : "1.1.0",
      updateCommand:
        "updateCommand" in input
          ? (input.updateCommand ?? null)
          : "npm install -g provider",
      canUpdate: input.canUpdate ?? true,
      checkedAt,
      message: "Update available.",
    },
  }

  return input.updateState
    ? { ...snapshot, updateState: input.updateState }
    : snapshot
}

function updateCandidate(
  input: Parameters<typeof provider>[0]
): ProviderUpdateCandidate {
  return provider(input) as ProviderUpdateCandidate
}

describe("provider update notification logic", () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("detects enabled providers with a latest-version advisory", () => {
    expect(isProviderUpdateCandidate(provider({ driver: "codex" }))).toBe(true)
    expect(
      isProviderUpdateCandidate(provider({ driver: "codex", enabled: false }))
    ).toBe(false)
    expect(
      isProviderUpdateCandidate(
        provider({
          driver: "codex",
          advisoryStatus: "current",
          latestVersion: null,
        })
      )
    ).toBe(false)
    expect(
      isProviderUpdateCandidate(
        provider({ driver: "codex", latestVersion: null })
      )
    ).toBe(false)
  })

  it("deduplicates multi-instance provider candidates by driver and prefers the default instance", () => {
    const candidates = collectProviderUpdateCandidates([
      provider({
        driver: "codex",
        instanceId: "codex-work",
        latestVersion: "1.1.0",
        checkedAt: laterCheckedAt,
      }),
      provider({
        driver: "codex",
        instanceId: "codex",
        latestVersion: "1.1.0",
      }),
      provider({ driver: "claude", latestVersion: "0.3.0" }),
    ])

    expect(candidates.map((candidate) => candidate.instanceId)).toEqual([
      "codex",
      "claude",
    ])
  })

  it("disables one-click updates when sibling instances disagree on update commands", () => {
    const candidate = updateCandidate({
      driver: "claude",
      instanceId: "claude-personal",
      latestVersion: "2.1.123",
      updateCommand: "npm install -g @anthropic-ai/claude-code@latest",
    })

    expect(
      canOneClickUpdateProviderCandidate(candidate, [
        candidate,
        provider({
          driver: "claude",
          instanceId: "claude-work",
          latestVersion: "2.1.123",
          canUpdate: true,
          updateCommand: "bun add -g @anthropic-ai/claude-code@latest",
        }),
      ])
    ).toBe(false)
  })

  it("keeps one-click updates enabled when sibling instances are already current", () => {
    const candidate = updateCandidate({
      driver: "claude",
      instanceId: "claude-personal",
      latestVersion: "2.1.123",
      updateCommand: "npm install -g @anthropic-ai/claude-code@latest",
    })

    const sibling = provider({
      driver: "claude",
      instanceId: "claude-work",
      version: "2.1.123",
      latestVersion: "2.1.123",
      advisoryStatus: "current",
      canUpdate: false,
      updateCommand: null,
    })

    expect(
      hasOneClickUpdateProviderCandidate(candidate, [candidate, sibling])
    ).toBe(true)
    expect(
      canOneClickUpdateProviderCandidate(candidate, [candidate, sibling])
    ).toBe(true)
  })

  it("keeps inline update capability visible while a provider update is running", () => {
    const candidate = updateCandidate({
      driver: "codex",
      updateState: {
        status: "running",
        startedAt: checkedAt,
        finishedAt: null,
        message: "Updating provider.",
        output: null,
      },
    })

    expect(hasOneClickUpdateProviderCandidate(candidate, [candidate])).toBe(
      true
    )
    expect(canOneClickUpdateProviderCandidate(candidate, [candidate])).toBe(
      false
    )
  })

  it("builds a notification key from latest versions only", () => {
    const first = updateCandidate({
      driver: "codex",
      version: "1.0.0",
      latestVersion: "1.2.0",
    })
    const samePublishedVersion = updateCandidate({
      driver: "codex",
      version: "1.1.0",
      latestVersion: "1.2.0",
    })
    const nextPublishedVersion = updateCandidate({
      driver: "codex",
      version: "1.1.0",
      latestVersion: "1.3.0",
    })

    expect(providerUpdateNotificationKey([first])).toBe(
      providerUpdateNotificationKey([samePublishedVersion])
    )
    expect(providerUpdateNotificationKey([nextPublishedVersion])).not.toBe(
      providerUpdateNotificationKey([first])
    )
    expect(providerUpdateNotificationKey([])).toBeNull()
  })

  it("describes one-click and settings-only update views", () => {
    const codex = updateCandidate({
      driver: "codex",
      latestVersion: "1.1.0",
    })

    expect(
      getProviderUpdateInitialView({
        updateProviders: [codex],
        oneClickProviders: [codex],
      })
    ).toMatchObject({
      phase: "initial",
      tone: "warning",
      title: "Update Available: Codex v1.1.0",
      description: "Install the update now or review provider settings.",
    })

    expect(
      getProviderUpdateInitialView({
        updateProviders: [
          updateCandidate({ driver: "codex", canUpdate: false }),
          updateCandidate({ driver: "cursor", canUpdate: false }),
        ],
        oneClickProviders: [],
      }).description
    ).toBe("Codex and Cursor can be updated from provider settings.")
  })

  it("uses server update state for progress views", () => {
    expect(
      getProviderUpdateProgressView({
        providers: [
          provider({
            driver: "codex",
            updateState: {
              status: "running",
              startedAt: checkedAt,
              finishedAt: null,
              message: "Updating provider.",
              output: null,
            },
          }),
        ],
        providerCount: 1,
      })
    ).toMatchObject({
      phase: "running",
      tone: "loading",
      title: "Updating provider",
    })

    expect(
      getProviderUpdateProgressView({
        providers: [
          provider({
            driver: "codex",
            updateState: {
              status: "failed",
              startedAt: checkedAt,
              finishedAt: checkedAt,
              message: "command failed",
              output: "stderr",
            },
          }),
        ],
        providerCount: 1,
      })
    ).toMatchObject({
      phase: "failed",
      tone: "error",
      title: "Provider update failed",
      description: "command failed",
    })

    expect(
      getProviderUpdateProgressView({
        providers: [
          provider({
            driver: "codex",
            version: "1.1.0",
            latestVersion: "1.1.0",
            advisoryStatus: "current",
            updateState: {
              status: "succeeded",
              startedAt: checkedAt,
              finishedAt: checkedAt,
              message: "Provider updated.",
              output: null,
            },
          }),
        ],
        providerCount: 1,
      })
    ).toMatchObject({
      phase: "succeeded",
      tone: "success",
      title: "Provider updated",
      dismissAfterVisibleMs: 3_000,
    })
  })

  it("collects only attempted provider snapshots from update responses", () => {
    const codex = provider({ driver: "codex" })
    const claude = provider({ driver: "claude" })
    const results: PromiseSettledResult<{
      readonly providers: ReadonlyArray<ProviderInstanceSnapshot>
    }>[] = [{ status: "fulfilled", value: { providers: [codex, claude] } }]

    expect(
      collectUpdatedProviderSnapshots({
        results,
        providerInstanceIds: new Set([claude.instanceId]),
      })
    ).toEqual([claude])
  })

  it("persists dismissed notification keys as best-effort local UI state", () => {
    expect(isProviderUpdateNotificationDismissed("codex:1.1.0")).toBe(false)

    dismissProviderUpdateNotification("codex:1.1.0")

    expect(isProviderUpdateNotificationDismissed("codex:1.1.0")).toBe(true)
    expect(localStorage.getItem(PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY)).toBe(
      JSON.stringify({ keys: ["codex:1.1.0"] })
    )
  })

  it("falls back to a rejected RPC message for transport-level failures", () => {
    expect(
      firstRejectedProviderUpdateMessage([
        { status: "rejected", reason: new Error("WebSocket closed") },
      ])
    ).toBe("WebSocket closed")
  })

  it("resolves single-provider progress titles for terminal states", () => {
    expect(
      getSingleProviderUpdateProgressView(
        provider({
          driver: "codex",
          updateState: {
            status: "failed",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "command failed",
            output: "stderr",
          },
        })
      )
    ).toMatchObject({
      phase: "failed",
      tone: "error",
      title: "Codex v1.1.0 update failed",
      description: "command failed",
    })

    expect(
      getSingleProviderUpdateProgressView(
        provider({
          driver: "codex",
          version: "1.1.0",
          latestVersion: "1.1.0",
          advisoryStatus: "current",
          updateState: {
            status: "succeeded",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "Provider updated.",
            output: null,
          },
        })
      )
    ).toMatchObject({
      phase: "succeeded",
      tone: "success",
      title: "Codex updated: v1.1.0",
    })
  })

  it("summarizes active provider updates for the sidebar pill", () => {
    const view = getProviderUpdateSidebarPillView([
      provider({
        driver: "codex",
        updateState: {
          status: "running",
          startedAt: checkedAt,
          finishedAt: null,
          message: "Updating provider.",
          output: null,
        },
      }),
      provider({
        driver: "claude",
        updateState: {
          status: "queued",
          startedAt: null,
          finishedAt: null,
          message: "Waiting for another provider update to finish.",
          output: null,
        },
      }),
    ])

    expect(view).toMatchObject({
      key: "loading:claude:queued|codex:running",
      tone: "loading",
      title: "Updating 2 providers",
      description: "Codex and Claude updates are in progress.",
    })
  })

  it("uses provider names for terminal sidebar pill states", () => {
    expect(
      getProviderUpdateSidebarPillView(
        [
          provider({
            driver: "claude",
            updateState: {
              status: "failed",
              startedAt: checkedAt,
              finishedAt: checkedAt,
              message: "Update command exited with code 1.",
              output: null,
            },
          }),
        ],
        { visibleAfterIso: "2026-04-23T09:59:00.000Z" }
      )
    ).toMatchObject({
      key: "failed:claude:2026-04-23T10:00:00.000Z:Update command exited with code 1.",
      tone: "error",
      title: "Claude v1.1.0 update failed",
      description: "Update command exited with code 1.",
      dismissible: true,
    })

    expect(
      getProviderUpdateSidebarPillView(
        [
          provider({
            driver: "codex",
            updateState: {
              status: "unchanged",
              startedAt: checkedAt,
              finishedAt: checkedAt,
              message: "still old",
              output: null,
            },
          }),
        ],
        { visibleAfterIso: "2026-04-23T09:59:00.000Z" }
      )
    ).toMatchObject({
      key: "unchanged:codex:2026-04-23T10:00:00.000Z:still old",
      tone: "warning",
      title: "Codex still needs an update",
      dismissible: true,
    })
  })

  it("shows newer terminal sidebar states before dismissed older ones", () => {
    const providers = [
      provider({
        driver: "claude",
        updateState: {
          status: "failed",
          startedAt: checkedAt,
          finishedAt: checkedAt,
          message: "Update command exited with code 1.",
          output: null,
        },
      }),
      provider({
        driver: "codex",
        version: "1.2.0",
        latestVersion: "1.2.0",
        advisoryStatus: "current",
        updateState: {
          status: "succeeded",
          startedAt: laterCheckedAt,
          finishedAt: laterCheckedAt,
          message: "Provider updated.",
          output: null,
        },
      }),
    ]

    const successView = getProviderUpdateSidebarPillView(providers, {
      visibleAfterIso: "2026-04-23T09:59:00.000Z",
    })
    expect(successView).toMatchObject({
      key: "succeeded:codex:2026-04-23T10:01:00.000Z:Provider updated.",
      tone: "success",
      title: "Codex updated: v1.2.0",
      dismissAfterVisibleMs: 3_000,
    })

    const failureView = getProviderUpdateSidebarPillView(providers, {
      visibleAfterIso: "2026-04-23T09:59:00.000Z",
      dismissedKeys: new Set([
        "succeeded:codex:2026-04-23T10:01:00.000Z:Provider updated.",
      ]),
    })
    expect(failureView).toMatchObject({
      key: "failed:claude:2026-04-23T10:00:00.000Z:Update command exited with code 1.",
      tone: "error",
      title: "Claude v1.1.0 update failed",
    })
  })

  it("does not show sidebar terminal states from before the current app session", () => {
    expect(
      getProviderUpdateSidebarPillView(
        [
          provider({
            driver: "codex",
            updateState: {
              status: "failed",
              startedAt: checkedAt,
              finishedAt: checkedAt,
              message: "command failed",
              output: "stderr",
            },
          }),
        ],
        { visibleAfterIso: "2026-04-23T10:00:01.000Z" }
      )
    ).toBeNull()
  })

  it("does not show a sidebar pill for passive update availability", () => {
    expect(
      getProviderUpdateSidebarPillView([
        provider({ driver: "codex", canUpdate: true }),
        provider({ driver: "claude", canUpdate: false }),
      ])
    ).toBeNull()
  })
})
