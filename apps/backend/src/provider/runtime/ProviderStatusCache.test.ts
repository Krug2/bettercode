import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import {
  hydrateCachedProviderSnapshot,
  isCachedProviderCorrelated,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "./ProviderStatusCache"

const createdDirs = new Set<string>()

afterEach(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  createdDirs.clear()
})

function tempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "betterc0de-provider-cache-")
  )
  createdDirs.add(dir)
  return dir
}

function provider(
  input: Partial<ProviderInstanceSnapshot> = {}
): ProviderInstanceSnapshot {
  const configured = input.configured ?? true
  return {
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    configured,
    installed: true,
    version: null,
    status: configured ? "ready" : "warning",
    auth: { status: configured ? "authenticated" : "unknown" },
    checkedAt: "2026-05-13T00:00:00.000Z",
    availability: "available",
    environment: [],
    config: {},
    models: [],
    providerCatalog: [],
    skills: [],
    agents: [],
    tools: [],
    slashCommands: [],
    ...input,
  }
}

describe("ProviderStatusCache", () => {
  it("writes and reads provider instance snapshots", async () => {
    const cacheDir = tempDir()
    const filePath = resolveProviderStatusCachePath({
      cacheDir,
      instanceId: "codex_work",
    })
    const snapshot = provider({
      instanceId: "codex_work",
      models: [
        {
          slug: "gpt-5.5",
          name: "GPT 5.5",
          isCustom: false,
          capabilities: null,
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
      skills: [{ name: "review", path: "/tmp/review", enabled: true }],
      tools: [{ id: "bash", displayName: "Bash" }],
      slashCommands: [{ name: "compact" }],
      metadata: { checkedAt: 123 },
      continuation: { groupKey: "codex:home:/Users/example/.codex-work" },
      continuationKey: "codex:home:/Users/example/.codex-work",
    })

    await writeProviderStatusCache({ filePath, provider: snapshot })

    expect(path.basename(filePath)).toBe("codex_work.json")
    await expect(readProviderStatusCache(filePath)).resolves.toEqual(snapshot)
  })

  it("reads server-provider snapshots and derives legacy configured fields", async () => {
    const cacheDir = tempDir()
    const filePath = resolveProviderStatusCachePath({
      cacheDir,
      instanceId: "claude",
    })
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        instanceId: "claude",
        driver: "claude",
        displayName: "Claude",
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-05-13T00:00:00.000Z",
        continuation: { groupKey: "claude:home:/Users/example" },
        models: [{ slug: "claude-opus-4-7", name: "Claude Opus 4.7" }],
      })}\n`,
      "utf8"
    )

    await expect(readProviderStatusCache(filePath)).resolves.toMatchObject({
      instanceId: "claude",
      configured: true,
      availability: "available",
      continuationKey: "claude:home:/Users/example",
      slashCommands: [],
      skills: [],
      agents: [],
      tools: [],
      providerCatalog: [],
    })
  })

  it("defaults provider metadata arrays when reading older provider snapshots", async () => {
    const cacheDir = tempDir()
    const filePath = resolveProviderStatusCachePath({
      cacheDir,
      instanceId: "codex",
    })
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-05-13T00:00:00.000Z",
      })}\n`,
      "utf8"
    )

    await expect(readProviderStatusCache(filePath)).resolves.toMatchObject({
      models: [],
      providerCatalog: [],
      slashCommands: [],
      skills: [],
      agents: [],
      tools: [],
    })
  })

  it("hydrates cached metadata while preserving current status probe fields", () => {
    const fallback = provider({
      models: [
        {
          slug: "gpt-5.5",
          name: "GPT 5.5",
          isCustom: false,
          capabilities: null,
        },
      ],
      skills: [],
      tools: [],
      slashCommands: [],
      metadata: { checkedAt: 200, skillsError: "scan failed" },
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      checkedAt: "2026-05-13T00:00:00.000Z",
      message: "Live scan failed",
    })
    const cached = provider({
      models: [
        {
          slug: "gpt-5.5",
          name: "Old GPT 5.5",
          isCustom: false,
          capabilities: null,
        },
        {
          slug: "gpt-5.4",
          name: "GPT 5.4",
          isCustom: false,
          capabilities: null,
        },
      ],
      skills: [{ name: "review", path: "/tmp/review", enabled: true }],
      agents: [{ name: "build", mode: "primary", hidden: false }],
      tools: [{ id: "bash", displayName: "Bash" }],
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
      slashCommands: [{ name: "compact" }],
      metadata: { checkedAt: 100 },
      installed: true,
      version: "1.2.3",
      status: "ready",
      auth: { status: "authenticated", type: "cli", label: "CLI" },
      checkedAt: "2026-05-13T01:00:00.000Z",
      message: "Cached ready",
    })

    expect(
      hydrateCachedProviderSnapshot({
        cachedProvider: cached,
        fallbackProvider: fallback,
      })
    ).toEqual({
      ...fallback,
      models: [
        {
          slug: "gpt-5.5",
          name: "GPT 5.5",
          isCustom: false,
          capabilities: null,
        },
        {
          slug: "gpt-5.4",
          name: "GPT 5.4",
          isCustom: false,
          capabilities: null,
        },
      ],
      skills: cached.skills,
      agents: cached.agents,
      tools: cached.tools,
      providerCatalog: cached.providerCatalog,
      slashCommands: cached.slashCommands,
      metadata: fallback.metadata,
    })
  })

  it("trusts the fresh model list from a healthy (ready) provider instead of resurrecting dropped cached models", () => {
    const fallback = provider({
      status: "ready",
      models: [{ slug: "gpt-5.5", name: "GPT 5.5", isCustom: false, capabilities: null }],
    })
    const cached = provider({
      status: "ready",
      models: [
        { slug: "gpt-5.5", name: "GPT 5.5", isCustom: false, capabilities: null },
        { slug: "gpt-5.4", name: "GPT 5.4 (removed)", isCustom: false, capabilities: null },
      ],
    })

    const hydrated = hydrateCachedProviderSnapshot({
      cachedProvider: cached,
      fallbackProvider: fallback,
    })

    expect(hydrated.models.map((model) => model.slug)).toEqual(["gpt-5.5"])
  })

  it("omits transient update state when writing provider status cache", async () => {
    const cacheDir = tempDir()
    const filePath = resolveProviderStatusCachePath({
      cacheDir,
      instanceId: "codex",
    })

    await writeProviderStatusCache({
      filePath,
      provider: provider({
        updateState: {
          status: "running",
          startedAt: "2026-05-13T01:00:00.000Z",
          finishedAt: null,
          message: "updating",
          output: "log",
        },
      }),
    })

    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).not.toHaveProperty(
      "updateState"
    )
  })

  it("rejects stale cached identity and disabled, unavailable, or unconfigured fallbacks", () => {
    const fallback = provider()
    const mismatched = provider({ instanceId: "codex-work" })
    const disabled = provider({
      enabled: false,
      configured: false,
      status: "disabled",
    })
    const unavailable = provider({
      configured: false,
      installed: false,
      status: "error",
      availability: "unavailable",
      unavailableReason: "Codex CLI missing",
    })
    const unconfigured = provider({
      configured: false,
      status: "warning",
      auth: { status: "unauthenticated" },
      message: "Codex is not configured",
    })

    expect(
      isCachedProviderCorrelated({
        cachedProvider: mismatched,
        fallbackProvider: fallback,
      })
    ).toBe(false)
    expect(
      hydrateCachedProviderSnapshot({
        cachedProvider: mismatched,
        fallbackProvider: fallback,
      })
    ).toEqual(fallback)
    expect(
      hydrateCachedProviderSnapshot({
        cachedProvider: fallback,
        fallbackProvider: disabled,
      })
    ).toEqual(disabled)
    expect(
      hydrateCachedProviderSnapshot({
        cachedProvider: fallback,
        fallbackProvider: unavailable,
      })
    ).toEqual(unavailable)
    expect(
      hydrateCachedProviderSnapshot({
        cachedProvider: fallback,
        fallbackProvider: unconfigured,
      })
    ).toEqual(unconfigured)
  })
})
