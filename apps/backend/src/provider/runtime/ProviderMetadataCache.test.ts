import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import type { ProviderAdapterShape, ProviderSkill } from "./contracts"
import {
  ProviderMetadataCache,
  ProviderMetadataCapacityError,
  ProviderMetadataInputError,
  boundedProviderLimit,
  hydrateAndPersistInstanceSnapshot,
  normalizeProviderMetadataCwd,
  providerMetadataCwdKey,
  toSnapshotMetadata,
} from "./ProviderMetadataCache"
import { resolveProviderStatusCachePath } from "./ProviderStatusCache"

const createdDirs = new Set<string>()

function tempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "betterc0de-metadata-cache-")
  )
  createdDirs.add(dir)
  return dir
}

afterAll(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

afterEach(() => {
  vi.useRealTimers()
})

/** Only the probe surface matters here; the rest never runs. */
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const skill = (name: string): ProviderSkill => ({
  name,
  path: `/skills/${name}`,
  enabled: true,
})

describe("ProviderMetadataCache", () => {
  it("serves a fresh entry from cache and re-probes after the TTL", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const availableSkills = vi.fn(async () => [skill("review")])
    const cache = new ProviderMetadataCache()
    const instance = { instanceId: "codex", adapter: stubAdapter({ availableSkills }) }

    const first = await cache.read(instance, "/repo", { force: false })
    const second = await cache.read(instance, "/repo", { force: false })
    expect(second).toBe(first)
    expect(availableSkills).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + ProviderMetadataCache.TTL_MS - 1)
    await cache.read(instance, "/repo", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 1)
    const third = await cache.read(instance, "/repo", { force: false })
    expect(third).not.toBe(first)
    expect(availableSkills).toHaveBeenCalledTimes(2)
  })

  it("keys entries per instance and per normalized cwd", async () => {
    const availableSkills = vi.fn(async () => [])
    const cache = new ProviderMetadataCache()
    const adapter = stubAdapter({ availableSkills })
    const codex = { instanceId: "codex", adapter }
    const project = path.join(process.cwd(), "virtual-project")

    await cache.read(codex, project, { force: false })
    // Lexically equivalent cwd → same key.
    await cache.read(codex, `  ${path.join(project, "nested", "..")}${path.sep}  `, {
      force: false,
    })
    expect(availableSkills).toHaveBeenCalledTimes(1)

    await cache.read(codex, null, { force: false })
    await cache.read({ instanceId: "codex_work", adapter }, project, {
      force: false,
    })
    expect(availableSkills).toHaveBeenCalledTimes(3)
    // The adapter sees the trimmed cwd, not the raw one.
    expect(availableSkills).toHaveBeenNthCalledWith(1, {
      cwd: project,
      force: false,
    })
  })

  it("lets a non-forced read join any in-flight probe but a forced read only a forced one", async () => {
    const pending = deferred<ProviderSkill[]>()
    const availableSkills = vi.fn(() => pending.promise)
    const cache = new ProviderMetadataCache()
    const instance = { instanceId: "codex", adapter: stubAdapter({ availableSkills }) }

    const plain = cache.read(instance, "/repo", { force: false })
    const joined = cache.read(instance, "/repo", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(1)
    expect(cache.inFlightPromises()).toHaveLength(1)

    // A forced read must really bypass the cache: it starts its own probe.
    const forced = cache.read(instance, "/repo", { force: true })
    expect(availableSkills).toHaveBeenCalledTimes(2)

    // ...and a later forced read joins the forced probe already running.
    const forcedAgain = cache.read(instance, "/repo", { force: true })
    // A later non-forced read joins whatever is in flight (now the forced one).
    const plainAgain = cache.read(instance, "/repo", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(2)
    expect(cache.inFlightPromises()).toHaveLength(2)

    pending.resolve([skill("review")])
    const [plainEntry, joinedEntry, forcedEntry, forcedAgainEntry, plainAgainEntry] =
      await Promise.all([plain, joined, forced, forcedAgain, plainAgain])
    // Joined reads resolve to the very entry their probe produced.
    expect(joinedEntry).toBe(plainEntry)
    expect(forcedAgainEntry).toBe(forcedEntry)
    expect(plainAgainEntry).toBe(forcedEntry)
    expect(cache.inFlightPromises()).toEqual([])
  })

  it("rejects new keys with a capacity error once the in-flight cap is reached", async () => {
    const pending = deferred<ProviderSkill[]>()
    const availableSkills = vi.fn(() => pending.promise)
    const cache = new ProviderMetadataCache({ inFlightMaxEntries: 1 })
    const instance = { instanceId: "codex", adapter: stubAdapter({ availableSkills }) }

    const first = cache.read(instance, "/repo-a", { force: false })
    await expect(
      cache.read(instance, "/repo-b", { force: false })
    ).rejects.toBeInstanceOf(ProviderMetadataCapacityError)
    // Joining the existing key is still allowed at the cap.
    const joined = cache.read(instance, "/repo-a", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(1)
    expect(cache.inFlightPromises()).toHaveLength(1)

    pending.resolve([])
    expect(await joined).toBe(await first)
    await expect(
      cache.read(instance, "/repo-b", { force: false })
    ).resolves.toMatchObject({ skills: [] })
  })

  it("bounds concurrent probes with the semaphore and its queue", async () => {
    const gates: Array<ReturnType<typeof deferred<ProviderSkill[]>>> = []
    let active = 0
    let peakActive = 0
    const availableSkills = vi.fn(async () => {
      active += 1
      peakActive = Math.max(peakActive, active)
      const gate = deferred<ProviderSkill[]>()
      gates.push(gate)
      try {
        return await gate.promise
      } finally {
        active -= 1
      }
    })
    const cache = new ProviderMetadataCache({
      concurrencyLimit: 1,
      queueMaxEntries: 1,
    })
    const instance = { instanceId: "codex", adapter: stubAdapter({ availableSkills }) }

    const first = cache.read(instance, "/repo-a", { force: false })
    const queued = cache.read(instance, "/repo-b", { force: false })
    await expect(
      cache.read(instance, "/repo-c", { force: false })
    ).rejects.toBeInstanceOf(ProviderMetadataCapacityError)
    // The rejected read must not leave a dangling in-flight key behind.
    expect(cache.inFlightPromises()).toHaveLength(2)

    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0]!.resolve([skill("a")])
    await first
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1]!.resolve([skill("b")])
    await queued
    expect(peakActive).toBe(1)
    expect(availableSkills).toHaveBeenCalledTimes(2)
  })

  it("keeps the previous lists and reports errors when individual probes fail", async () => {
    let failSkills = false
    const adapter = stubAdapter({
      availableSkills: async () => {
        if (failSkills) throw new Error("skills exploded")
        return [skill("review")]
      },
      availableTools: async () => [{ id: "bash", displayName: "Bash" }],
    })
    const cache = new ProviderMetadataCache()
    const instance = { instanceId: "codex", adapter }

    const healthy = await cache.read(instance, "/repo", { force: false })
    expect(healthy.skills).toEqual([skill("review")])
    expect(healthy.skillsError).toBeUndefined()

    failSkills = true
    const degraded = await cache.read(instance, "/repo", { force: true })
    expect(degraded.skills).toEqual([skill("review")])
    expect(degraded.skillsError).toBe("Provider skills could not be loaded.")
    expect(degraded.tools).toEqual([{ id: "bash", displayName: "Bash" }])
    expect(degraded.toolsError).toBeUndefined()
    // Probes the adapter does not implement resolve to empty lists, not errors.
    expect(degraded.agents).toEqual([])
    expect(degraded.agentsError).toBeUndefined()
  })

  it("invalidates one cwd bucket, or the whole instance when no cwd is given", async () => {
    const availableSkills = vi.fn(async () => [])
    const cache = new ProviderMetadataCache()
    const instance = { instanceId: "codex", adapter: stubAdapter({ availableSkills }) }

    await cache.read(instance, "/repo-a", { force: false })
    await cache.read(instance, "/repo-b", { force: false })
    await cache.read(instance, null, { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(3)

    cache.invalidate("codex", "/repo-a")
    await cache.read(instance, "/repo-a", { force: false })
    await cache.read(instance, "/repo-b", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(4)

    // `null` is the "no cwd" bucket, not a wildcard.
    cache.invalidate("codex", null)
    await cache.read(instance, null, { force: false })
    await cache.read(instance, "/repo-b", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(5)

    cache.invalidate("codex")
    await cache.read(instance, "/repo-a", { force: false })
    await cache.read(instance, "/repo-b", { force: false })
    await cache.read(instance, null, { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(8)
  })

  it("invalidates cached admission while retaining the old probe for shutdown", async () => {
    const pending = deferred<ProviderSkill[]>()
    const availableSkills = vi
      .fn<NonNullable<ProviderAdapterShape["availableSkills"]>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue([skill("fresh")])
    const cache = new ProviderMetadataCache()
    const instance = { instanceId: "codex", adapter: stubAdapter({ availableSkills }) }

    const stale = cache.read(instance, "/repo", { force: false })
    cache.invalidateInstance("codex")
    expect(cache.inFlightPromises()).toHaveLength(1)

    const fresh = await cache.read(instance, "/repo", { force: false })
    expect(fresh.skills).toEqual([skill("fresh")])

    // The superseded probe settles but must not overwrite the fresh entry.
    pending.resolve([skill("stale")])
    await stale
    expect(cache.inFlightPromises()).toEqual([])
    const cached = await cache.read(instance, "/repo", { force: false })
    expect(cached.skills).toEqual([skill("fresh")])
    expect(availableSkills).toHaveBeenCalledTimes(2)
  })

  it("retains only the next registry generation's instances", async () => {
    const availableSkills = vi.fn(async () => [])
    const cache = new ProviderMetadataCache()
    const adapter = stubAdapter({ availableSkills })
    const kept = { instanceId: "codex", adapter }
    const dropped = { instanceId: "codex_old", adapter }
    // A prefix collision must not retain the wrong instance: "codex" is a
    // prefix of "codex_old", only the NUL-delimited id counts.
    await cache.read(kept, "/repo", { force: false })
    await cache.read(dropped, "/repo", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(2)

    cache.retainInstances(new Set(["codex"]))

    await cache.read(kept, "/repo", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(2)
    await cache.read(dropped, "/repo", { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(3)
  })

  it("evicts the oldest entries past the size cap without touching the key being written", async () => {
    const availableSkills = vi.fn(async () => [])
    const cache = new ProviderMetadataCache()
    const adapter = stubAdapter({ availableSkills })
    for (let index = 0; index < ProviderMetadataCache.MAX_ENTRIES; index += 1) {
      await cache.read({ instanceId: `i${index}`, adapter }, null, {
        force: false,
      })
    }
    expect(availableSkills).toHaveBeenCalledTimes(
      ProviderMetadataCache.MAX_ENTRIES
    )

    // Writing one more evicts the oldest; the newest survive.
    await cache.read({ instanceId: "overflow", adapter }, null, { force: false })
    await cache.read({ instanceId: "overflow", adapter }, null, { force: false })
    await cache.read(
      { instanceId: `i${ProviderMetadataCache.MAX_ENTRIES - 1}`, adapter },
      null,
      { force: false }
    )
    expect(availableSkills).toHaveBeenCalledTimes(
      ProviderMetadataCache.MAX_ENTRIES + 1
    )
    await cache.read({ instanceId: "i0", adapter }, null, { force: false })
    expect(availableSkills).toHaveBeenCalledTimes(
      ProviderMetadataCache.MAX_ENTRIES + 2
    )
  })

  it("clamps operational limits to the hard caps", () => {
    expect(boundedProviderLimit(undefined, 4)).toBe(4)
    expect(boundedProviderLimit(Number.NaN, 4)).toBe(4)
    expect(boundedProviderLimit(Number.POSITIVE_INFINITY, 4)).toBe(4)
    expect(boundedProviderLimit(99, 4)).toBe(4)
    expect(boundedProviderLimit(0, 4)).toBe(1)
    expect(boundedProviderLimit(-3, 4)).toBe(1)
    expect(boundedProviderLimit(2.9, 4)).toBe(2)
  })
})

describe("provider metadata cwd", () => {
  it("normalizes blank input to null and rejects hostile input", () => {
    expect(normalizeProviderMetadataCwd(undefined)).toBeNull()
    expect(normalizeProviderMetadataCwd(null)).toBeNull()
    expect(normalizeProviderMetadataCwd("   ")).toBeNull()
    expect(normalizeProviderMetadataCwd("  /repo  ")).toBe("/repo")
    expect(() => normalizeProviderMetadataCwd("/repo x")).toThrow(
      ProviderMetadataInputError
    )
    expect(() => normalizeProviderMetadataCwd("x".repeat(4_097))).toThrow(
      ProviderMetadataInputError
    )
    expect(normalizeProviderMetadataCwd("x".repeat(4_096))).toHaveLength(4_096)
  })

  it("derives a resolved, platform-cased key", () => {
    expect(providerMetadataCwdKey(null)).toBe("")
    expect(providerMetadataCwdKey("  ")).toBe("")
    const project = path.join(process.cwd(), "Virtual-Project")
    const expected =
      process.platform === "win32"
        ? path.resolve(project).toLowerCase()
        : path.resolve(project)
    expect(providerMetadataCwdKey(project)).toBe(expected)
    expect(providerMetadataCwdKey(path.join(project, "nested", ".."))).toBe(
      expected
    )
  })

  it("exposes typed HTTP-shaped errors", () => {
    expect(new ProviderMetadataInputError()).toMatchObject({
      statusCode: 400,
      code: "invalid_provider_cwd",
      name: "ProviderMetadataInputError",
    })
    expect(new ProviderMetadataCapacityError()).toMatchObject({
      statusCode: 503,
      code: "provider_metadata_capacity",
      name: "ProviderMetadataCapacityError",
    })
  })
})

describe("toSnapshotMetadata", () => {
  it("carries checkedAt and only the error fields that are set", () => {
    expect(
      toSnapshotMetadata({
        checkedAt: 42,
        providerCatalog: [],
        skills: [],
        agents: [],
        tools: [],
        slashCommands: [],
      })
    ).toEqual({ checkedAt: 42 })
    expect(
      toSnapshotMetadata({
        checkedAt: 42,
        providerCatalog: [],
        skills: [],
        agents: [],
        tools: [],
        slashCommands: [],
        skillsError: "no skills",
        toolsError: "no tools",
      })
    ).toEqual({ checkedAt: 42, skillsError: "no skills", toolsError: "no tools" })
  })
})

describe("hydrateAndPersistInstanceSnapshot", () => {
  const healthy = {
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    configured: true,
    installed: true,
    version: "1.0.0",
    status: "ready" as const,
    auth: { status: "authenticated" as const },
    checkedAt: "2026-05-13T00:00:00.000Z",
    availability: "available" as const,
    models: [{ slug: "gpt-5.5", name: "GPT 5.5", isCustom: false, capabilities: null }],
    skills: [skill("review")],
  }

  it("passes the snapshot through untouched without a cache dir", async () => {
    await expect(hydrateAndPersistInstanceSnapshot(null, healthy)).resolves.toBe(
      healthy
    )
  })

  it("persists a healthy snapshot and hydrates a later degraded one from it", async () => {
    const cacheDir = tempDir()
    const filePath = resolveProviderStatusCachePath({
      cacheDir,
      instanceId: "codex",
    })

    await hydrateAndPersistInstanceSnapshot(cacheDir, healthy)
    expect(fs.existsSync(filePath)).toBe(true)

    // Transient enumeration failure: status "warning", nothing listed.
    const degraded = {
      ...healthy,
      status: "warning" as const,
      models: [],
      skills: [],
    }
    const hydrated = await hydrateAndPersistInstanceSnapshot(cacheDir, degraded)
    expect(hydrated.models).toEqual(healthy.models)
    expect(hydrated.skills).toEqual(healthy.skills)
    expect(hydrated.status).toBe("warning")
  })

  it("does not persist an instance that is not worth remembering", async () => {
    const cacheDir = tempDir()
    const filePath = resolveProviderStatusCachePath({
      cacheDir,
      instanceId: "codex",
    })
    const unconfigured = { ...healthy, configured: false, models: [] }
    await expect(
      hydrateAndPersistInstanceSnapshot(cacheDir, unconfigured)
    ).resolves.toBe(unconfigured)
    expect(fs.existsSync(filePath)).toBe(false)

    const unavailable = { ...healthy, unavailableReason: "gone" }
    await hydrateAndPersistInstanceSnapshot(cacheDir, unavailable)
    expect(fs.existsSync(filePath)).toBe(false)
  })
})
