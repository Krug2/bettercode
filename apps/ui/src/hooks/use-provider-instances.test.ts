import { describe, expect, it } from "vitest"
import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import { providerMetadataRefreshTargets } from "@/hooks/use-provider-instances"

describe("providerMetadataRefreshTargets", () => {
  const instances = [
    {
      instanceId: "codex",
      driver: "codex",
    },
    {
      instanceId: "codex-work",
      driver: "codex",
    },
    {
      instanceId: "claude-main",
      driver: "claude",
    },
    {
      instanceId: "claude-legacy",
      driver: "claudeAgent",
    },
    {
      instanceId: "BetterC0de",
      driver: "BetterC0de",
    },
  ] as ProviderInstanceSnapshot[]

  it("refreshes an explicit provider instance id first", () => {
    expect(
      providerMetadataRefreshTargets(instances, {
        providerKind: "codex",
        providerInstanceId: "codex-work",
        metadataKind: "skills",
      })
    ).toEqual(["codex-work"])
  })

  it("refreshes every matching provider-kind instance", () => {
    expect(
      providerMetadataRefreshTargets(instances, {
        providerKind: "codex",
        metadataKind: "skills",
      })
    ).toEqual(["codex", "codex-work"])
  })

  it("falls back to default native instance ids before snapshots load", () => {
    expect(
      providerMetadataRefreshTargets([], {
        providerKind: "claude",
        metadataKind: "skills",
      })
    ).toEqual(["claude"])
  })

  it("normalizes provider aliases before matching metadata refresh targets", () => {
    expect(
      providerMetadataRefreshTargets(instances, {
        providerKind: "claudeAgent",
        metadataKind: "skills",
      })
    ).toEqual(["claude-main", "claude-legacy"])
  })

  it("falls back to the normalized driver id for providers not yet loaded", () => {
    expect(
      providerMetadataRefreshTargets([], {
        providerKind: "BetterC0de",
        metadataKind: "skills",
      })
    ).toEqual(["betterc0de"])
  })
})
