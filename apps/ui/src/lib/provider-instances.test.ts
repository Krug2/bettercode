import { describe, expect, it } from "vitest"
import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import {
  deriveProviderInstanceEntries,
  normalizeProviderDriverKind,
  normalizeProviderAccentColor,
  resolveProviderDriverKindForInstanceSelection,
  resolveSelectableProviderInstance,
  sortProviderInstanceEntries,
} from "@/lib/provider-instances"

function provider(input: {
  driver: string
  instanceId: string
  enabled?: boolean
  configured?: boolean
  installed?: boolean
  status?: ProviderInstanceSnapshot["status"]
  availability?: ProviderInstanceSnapshot["availability"]
  unavailableReason?: string
  displayName?: string
  accentColor?: string
  continuationKey?: string
}): ProviderInstanceSnapshot {
  const configured = input.configured ?? true
  return {
    instanceId: input.instanceId,
    driver: input.driver,
    displayName: input.displayName,
    accentColor: input.accentColor,
    enabled: input.enabled ?? true,
    configured,
    installed: input.installed ?? true,
    version: null,
    status: input.status ?? (configured ? "ready" : "warning"),
    auth: { status: configured ? "authenticated" : "unknown" },
    checkedAt: "2026-05-13T00:00:00.000Z",
    availability: input.availability ?? "available",
    unavailableReason: input.unavailableReason,
    continuationKey: input.continuationKey,
    ...(input.continuationKey
      ? { continuation: { groupKey: input.continuationKey } }
      : {}),
    environment: [],
    config: {},
    models: [],
    providerCatalog: [],
    skills: [],
    agents: [],
    tools: [],
    slashCommands: [],
  }
}

describe("deriveProviderInstanceEntries", () => {
  it("uses exact instance id and normalized driver kind from the snapshot", () => {
    const [entry] = deriveProviderInstanceEntries([
      provider({ driver: "codex_cli", instanceId: "codex_personal" }),
    ])

    expect(entry?.instanceId).toBe("codex_personal")
    expect(entry?.driverKind).toBe("codex")
    expect(entry?.isDefault).toBe(false)
    expect(entry?.displayName).toBe("Codex Personal")
  })

  it("maps known legacy driver aliases while preserving unknown driver slugs", () => {
    expect(normalizeProviderDriverKind("claudeAgent")).toBe("claude")
    expect(normalizeProviderDriverKind("anthropic_cli")).toBe("claude")
    expect(normalizeProviderDriverKind("claude-terminal")).toBe("claude")
    expect(normalizeProviderDriverKind("cursor")).toBe("cursor")
    expect(normalizeProviderDriverKind("cursor-agent")).toBe("cursor")
    expect(normalizeProviderDriverKind("betterc0de")).toBe("betterc0de")
    expect(normalizeProviderDriverKind("BetterC0de-cli")).toBe("betterc0de")
    expect(normalizeProviderDriverKind("futureProvider")).toBe("futureProvider")

    const [entry] = deriveProviderInstanceEntries([
      provider({ driver: "futureProvider", instanceId: "futureProvider" }),
    ])
    expect(entry?.driverKind).toBe("futureProvider")
    expect(entry?.isDefault).toBe(true)
  })

  it("labels Cursor and BetterC0de default instances as first-party providers", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ driver: "cursor", instanceId: "cursor" }),
      provider({ driver: "betterc0de", instanceId: "betterc0de" }),
    ])

    expect(entries.map((entry) => entry.displayName)).toEqual([
      "Cursor",
      "BetterC0de",
    ])
    expect(entries.every((entry) => entry.isDefault)).toBe(true)
  })

  it("keeps explicit custom display names and valid accent colors", () => {
    const [entry] = deriveProviderInstanceEntries([
      provider({
        driver: "claude",
        instanceId: "claude_work",
        displayName: "Claude Work",
        accentColor: " #aabbCC ",
      }),
    ])

    expect(entry?.displayName).toBe("Claude Work")
    expect(entry?.accentColor).toBe("#aabbCC")
    expect(normalizeProviderAccentColor("red")).toBeUndefined()
  })

  it("preserves provider-scoped skills, slash commands, and metadata", () => {
    const [entry] = deriveProviderInstanceEntries([
      {
        ...provider({ driver: "codex", instanceId: "codex" }),
        models: [
          {
            slug: "openai/gpt-5",
            name: "GPT-5",
            isCustom: false,
            capabilities: null,
            catalog: {
              providerId: "openai",
              modelId: "gpt-5",
              status: "active",
              limit: { context: 1_000_000 },
            },
          },
        ],
        providerCatalog: [
          {
            id: "openai",
            name: "OpenAI",
            connected: true,
            enabled: true,
            env: [],
            endpoint: { type: "aisdk", package: "@ai-sdk/openai" },
            modelCount: 1,
          },
        ],
        agents: [
          { name: "build", mode: "primary", hidden: false },
          { name: "review", mode: "subagent", hidden: true },
        ],
        skills: [{ name: "review", path: "/tmp/review", enabled: true }],
        tools: [{ id: "bash", displayName: "Bash" }],
        slashCommands: [{ name: "compact" }],
        metadata: { checkedAt: 123 },
      },
    ])

    expect(entry?.skills).toEqual([
      { name: "review", path: "/tmp/review", enabled: true },
    ])
    expect(entry?.agents).toEqual([
      { name: "build", mode: "primary", hidden: false },
      { name: "review", mode: "subagent", hidden: true },
    ])
    expect(entry?.tools).toEqual([{ id: "bash", displayName: "Bash" }])
    expect(entry?.models[0]?.catalog).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      status: "active",
      limit: { context: 1_000_000 },
    })
    expect(entry?.providerCatalog).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        enabled: true,
        env: [],
        endpoint: { type: "aisdk", package: "@ai-sdk/openai" },
        modelCount: 1,
      },
    ])
    expect(entry?.slashCommands).toEqual([{ name: "compact" }])
    expect(entry?.snapshot.metadata?.checkedAt).toBe(123)
  })

  it("derives server-provider status, auth, and continuation fields", () => {
    const [entry] = deriveProviderInstanceEntries([
      provider({
        driver: "claude",
        instanceId: "claude_work",
        configured: true,
        status: "ready",
        continuationKey: "claude:home:/Users/example",
      }),
    ])

    expect(entry?.installed).toBe(true)
    expect(entry?.status).toBe("ready")
    expect(entry?.authStatus).toBe("authenticated")
    expect(entry?.isAvailable).toBe(true)
    expect(entry?.continuationGroupKey).toBe("claude:home:/Users/example")
  })
})

describe("sortProviderInstanceEntries", () => {
  it("keeps defaults before custom instances within each driver kind", () => {
    const entries = sortProviderInstanceEntries(
      deriveProviderInstanceEntries([
        provider({ driver: "codex", instanceId: "codex_work" }),
        provider({ driver: "codex", instanceId: "codex" }),
        provider({ driver: "claude", instanceId: "claude_work" }),
      ])
    )

    expect(entries.map((entry) => entry.instanceId)).toEqual([
      "codex",
      "codex_work",
      "claude_work",
    ])
  })
})

describe("resolveSelectableProviderInstance", () => {
  it("returns the requested instance when it is enabled and available", () => {
    const requested = "claude_work"
    const providers = [
      provider({ driver: "codex", instanceId: "codex" }),
      provider({ driver: "claude", instanceId: requested }),
    ]

    expect(resolveSelectableProviderInstance(providers, requested)).toBe(
      requested
    )
  })

  it("falls back to the first enabled and available instance", () => {
    const providers = [
      provider({ driver: "codex", instanceId: "codex", enabled: false }),
      provider({ driver: "claude", instanceId: "claude" }),
    ]

    expect(resolveSelectableProviderInstance(providers, "codex")).toBe("claude")
  })

  it("does not return disabled, unconfigured, unavailable, or unknown instances when none are sendable", () => {
    const providers = [
      provider({ driver: "codex", instanceId: "codex", enabled: false }),
      provider({ driver: "claude", instanceId: "claude", configured: false }),
      provider({
        driver: "codex",
        instanceId: "codex_work",
        availability: "unavailable",
        unavailableReason: "missing cli",
      }),
    ]

    expect(
      resolveSelectableProviderInstance(providers, "codex")
    ).toBeUndefined()
    expect(
      resolveSelectableProviderInstance(providers, "claude")
    ).toBeUndefined()
    expect(
      resolveSelectableProviderInstance(providers, "removed_instance")
    ).toBeUndefined()
  })
})

describe("resolveProviderDriverKindForInstanceSelection", () => {
  it("maps custom provider instance ids back to their driver kind", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ driver: "codex", instanceId: "codex" }),
      provider({ driver: "claude", instanceId: "claude_openrouter" }),
    ])

    expect(
      resolveProviderDriverKindForInstanceSelection(
        entries,
        "claude_openrouter"
      )
    ).toBe("claude")
  })

  it("does not guess a provider kind when the instance selection is unknown", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ driver: "codex", instanceId: "codex", enabled: false }),
      provider({ driver: "claude", instanceId: "claude" }),
    ])

    expect(
      resolveProviderDriverKindForInstanceSelection(entries, "removed_instance")
    ).toBeUndefined()
  })
})
