import { describe, expect, it, vi } from "vitest"
import type { ProviderAdapterShape, ProviderModel } from "./contracts"
import type { ProjectProviderPolicy } from "./projectProviderPolicy"
import {
  ProviderCatalogs,
  normalizeProviderModels,
  readAdapterModels,
} from "./ProviderCatalogs"

function stubAdapter(
  overrides: Partial<ProviderAdapterShape> = {}
): ProviderAdapterShape {
  return {
    provider: "codex",
    displayName: "Codex",
    capabilities: {
      supportsStreaming: true,
      supportsTools: true,
      supportsApprovals: true,
      supportsResume: true,
      managesOwnLifecycle: true,
    },
    isConfigured: () => true,
    availableModels: async () => [],
    startSession: async () => {
      throw new Error("not used")
    },
    sendTurn: async () => {},
    interruptTurn: async () => {},
    respondToRequest: async () => {},
    stopSession: async () => {},
    hasSession: () => false,
    subscribe: () => () => {},
    stopAll: async () => {},
    ...overrides,
  }
}

const codex = {
  instanceId: "codex",
  driver: "codex",
  provider: "codex",
  displayName: "Codex",
}

const models: ProviderModel[] = [
  { slug: "gpt-live", name: "GPT Live", catalog: { providerId: "openai", modelId: "gpt-live" } },
  { slug: "gpt-blocked", name: "GPT Blocked", catalog: { providerId: "openai", modelId: "gpt-blocked" } },
  { slug: "gpt-other", name: "GPT Other", catalog: { providerId: "openai", modelId: "gpt-other" } },
]

const modelPolicy: ProjectProviderPolicy = {
  enabledProviders: [],
  disabledProviders: [],
  providers: [{ id: "openai", whitelist: ["gpt-live"], blacklist: ["gpt-blocked"] }],
}

describe("ProviderCatalogs.loadProjectPolicy", () => {
  it("skips the loader entirely without a workspace", async () => {
    const loader = vi.fn(async () => modelPolicy)
    const catalogs = new ProviderCatalogs(loader)
    await expect(catalogs.loadProjectPolicy(undefined)).resolves.toBeNull()
    await expect(catalogs.loadProjectPolicy(null)).resolves.toBeNull()
    await expect(catalogs.loadProjectPolicy("   ")).resolves.toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it("hands the trimmed workspace to the loader", async () => {
    const loader = vi.fn(async () => modelPolicy)
    const catalogs = new ProviderCatalogs(loader)
    await expect(catalogs.loadProjectPolicy("  /repo  ")).resolves.toBe(
      modelPolicy
    )
    expect(loader).toHaveBeenCalledWith("/repo")
  })

  it("fails closed when the policy cannot be read", async () => {
    const catalogs = new ProviderCatalogs(async () => {
      throw new Error("invalid project provider policy")
    })
    await expect(catalogs.loadProjectPolicy("/repo")).rejects.toThrow(
      "invalid project provider policy"
    )
    await expect(
      catalogs.assertInstanceAllowed({ instance: codex, projectPath: "/repo" })
    ).rejects.toThrow("invalid project provider policy")
    await expect(
      catalogs.modelsForTarget(codex, stubAdapter(), "/repo")
    ).rejects.toThrow("invalid project provider policy")
  })
})

describe("ProviderCatalogs.modelsForTarget", () => {
  it("returns the adapter's models unfiltered without a workspace", async () => {
    const loader = vi.fn(async () => modelPolicy)
    const catalogs = new ProviderCatalogs(loader)
    const adapter = stubAdapter({ availableModels: async () => models })
    await expect(catalogs.modelsForTarget(codex, adapter)).resolves.toBe(
      models
    )
    expect(loader).not.toHaveBeenCalled()
  })

  it("filters models by the workspace policy for the target provider", async () => {
    const catalogs = new ProviderCatalogs(async () => modelPolicy)
    const adapter = stubAdapter({ availableModels: async () => models })
    const filtered = await catalogs.modelsForTarget(codex, adapter, "/repo")
    expect(filtered.map((model) => model.slug)).toEqual(["gpt-live"])
  })

  it("propagates an adapter failure instead of masking it", async () => {
    const loader = vi.fn(async () => modelPolicy)
    const catalogs = new ProviderCatalogs(loader)
    const adapter = stubAdapter({
      availableModels: async () => {
        throw new Error("model enumeration failed")
      },
    })
    await expect(
      catalogs.modelsForTarget(codex, adapter, "/repo")
    ).rejects.toThrow("model enumeration failed")
    // The adapter is asked first; a broken adapter never reaches the policy.
    expect(loader).not.toHaveBeenCalled()
  })
})

describe("ProviderCatalogs.assertInstanceAllowed", () => {
  it("returns the policy untouched when it says nothing about providers", async () => {
    const catalogs = new ProviderCatalogs(async () => modelPolicy)
    await expect(
      catalogs.assertInstanceAllowed({ instance: codex, projectPath: "/repo" })
    ).resolves.toBe(modelPolicy)
    const bare = new ProviderCatalogs(async () => null)
    await expect(
      catalogs.assertInstanceAllowed({ instance: codex })
    ).resolves.toBeNull()
    await expect(
      bare.assertInstanceAllowed({ instance: codex, projectPath: "/repo" })
    ).resolves.toBeNull()
  })

  it("rejects a provider the workspace disabled, naming it for the user", async () => {
    const policy: ProjectProviderPolicy = {
      enabledProviders: [],
      disabledProviders: ["codex"],
    }
    const catalogs = new ProviderCatalogs(async () => policy)
    await expect(
      catalogs.assertInstanceAllowed({ instance: codex, projectPath: "/repo" })
    ).rejects.toThrow(
      "Provider 'Codex' is disabled by this workspace's BetterC0de provider policy."
    )
    // Without a display name the message falls back to the provider kind.
    await expect(
      catalogs.assertInstanceAllowed({
        instance: { instanceId: "codex_work", driver: "codex", provider: "codex" },
        projectPath: "/repo",
      })
    ).rejects.toThrow("Provider 'codex' is disabled")
  })

  it("rejects a provider missing from an explicit enable list and allows a listed one", async () => {
    const policy: ProjectProviderPolicy = {
      enabledProviders: ["claude"],
      disabledProviders: [],
    }
    const catalogs = new ProviderCatalogs(async () => policy)
    await expect(
      catalogs.assertInstanceAllowed({ instance: codex, projectPath: "/repo" })
    ).rejects.toThrow(/disabled by this workspace/)
    await expect(
      catalogs.assertInstanceAllowed({
        instance: { instanceId: "claude", driver: "claude", displayName: "Claude" },
        projectPath: "/repo",
      })
    ).resolves.toBe(policy)
  })
})

describe("ProviderCatalogs.assertModelAllowed", () => {
  const catalogs = new ProviderCatalogs(async () => null)

  it("accepts a blank model or a missing policy", () => {
    expect(() =>
      catalogs.assertModelAllowed({ instance: codex, model: "  ", policy: modelPolicy })
    ).not.toThrow()
    expect(() =>
      catalogs.assertModelAllowed({ instance: codex, model: undefined, policy: modelPolicy })
    ).not.toThrow()
    expect(() =>
      catalogs.assertModelAllowed({ instance: codex, model: "gpt-blocked", policy: null })
    ).not.toThrow()
  })

  it("enforces the whitelist and blacklist for the matching provider", () => {
    expect(() =>
      catalogs.assertModelAllowed({ instance: codex, model: "gpt-live", policy: modelPolicy })
    ).not.toThrow()
    expect(() =>
      catalogs.assertModelAllowed({ instance: codex, model: " gpt-blocked ", policy: modelPolicy })
    ).toThrow(
      "Model 'gpt-blocked' is disabled by this workspace's BetterC0de provider policy for provider 'Codex'."
    )
    expect(() =>
      catalogs.assertModelAllowed({ instance: codex, model: "gpt-other", policy: modelPolicy })
    ).toThrow(/disabled by this workspace/)
    // A provider the policy does not mention is unrestricted.
    expect(() =>
      catalogs.assertModelAllowed({
        instance: { instanceId: "claude", driver: "claude", displayName: "Claude" },
        model: "gpt-other",
        policy: modelPolicy,
      })
    ).not.toThrow()
  })
})

describe("readAdapterModels", () => {
  it("forwards the force flag and degrades a failing adapter to no models", async () => {
    const availableModels = vi.fn(async () => models)
    await expect(
      readAdapterModels(stubAdapter({ availableModels }), { force: true })
    ).resolves.toBe(models)
    expect(availableModels).toHaveBeenCalledWith({ force: true })
    await expect(
      readAdapterModels(
        stubAdapter({
          availableModels: async () => {
            throw new Error("boom")
          },
        })
      )
    ).resolves.toEqual([])
  })
})

describe("normalizeProviderModels", () => {
  it("fills the optional wire fields without overriding explicit ones", () => {
    expect(
      normalizeProviderModels([
        { slug: "a", name: "A" },
        { slug: "b", name: "B", isCustom: true, capabilities: { reasoning: true } as never },
      ])
    ).toEqual([
      { slug: "a", name: "A", isCustom: false, capabilities: null },
      { slug: "b", name: "B", isCustom: true, capabilities: { reasoning: true } },
    ])
  })
})
