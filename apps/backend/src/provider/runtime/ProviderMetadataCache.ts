import path from "node:path"
import type {
  ProviderAdapterShape,
  ProviderAgent,
  ProviderCatalogEntry,
  ProviderInstanceMetadata,
  ProviderSkill,
  ProviderSlashCommand,
  ProviderTool,
} from "./contracts"
import {
  hydrateCachedProviderSnapshot,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
  type CacheableProviderSnapshot,
} from "./ProviderStatusCache"

/**
 * Per-instance, per-cwd cache of the slow provider metadata probes (catalog,
 * skills, agents, tools, slash commands). Every read is bounded three ways:
 * a TTL on cached entries, a semaphore on concurrent adapter probes, and a
 * cap on the number of in-flight keys — each probe can be a child-process
 * spawn, and the frontend fans listInstances out generously.
 */

export interface ProviderMetadataCacheEntry {
  readonly checkedAt: number
  readonly providerCatalog: ReadonlyArray<ProviderCatalogEntry>
  readonly skills: ReadonlyArray<ProviderSkill>
  readonly agents: ReadonlyArray<ProviderAgent>
  readonly tools: ReadonlyArray<ProviderTool>
  readonly slashCommands: ReadonlyArray<ProviderSlashCommand>
  readonly skillsError?: string
  readonly providerCatalogError?: string
  readonly agentsError?: string
  readonly toolsError?: string
  readonly slashCommandsError?: string
}

interface ProviderMetadataInFlightEntry {
  readonly force: boolean
  readonly promise: Promise<ProviderMetadataCacheEntry>
}

export interface ProviderMetadataCacheLimits {
  /** Optional lower operational limits; values cannot exceed the hard caps. */
  readonly concurrencyLimit?: number
  readonly queueMaxEntries?: number
  readonly inFlightMaxEntries?: number
  /**
   * Ceiling for one adapter probe. Longer than a session-admission deadline
   * so an 8s command probe can still succeed; a hung probe releases the slot.
   */
  readonly probeTimeoutMs?: number
}

export class ProviderMetadataInputError extends Error {
  readonly statusCode = 400
  readonly code = "invalid_provider_cwd"

  constructor() {
    super("provider cwd is invalid")
    this.name = "ProviderMetadataInputError"
  }
}

export class ProviderMetadataCapacityError extends Error {
  readonly statusCode = 503
  readonly code = "provider_metadata_capacity"

  constructor() {
    super("provider metadata request capacity exhausted")
    this.name = "ProviderMetadataCapacityError"
  }
}

class BoundedAsyncSemaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.waiters.length >= this.maxQueued) {
        throw new ProviderMetadataCapacityError()
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    } else {
      this.active += 1
    }

    try {
      return await operation()
    } finally {
      const next = this.waiters.shift()
      if (next) {
        next()
      } else {
        this.active -= 1
      }
    }
  }
}

export class ProviderMetadataCache {
  static readonly TTL_MS = 5 * 60_000
  static readonly MAX_ENTRIES = 256
  static readonly CONCURRENCY_LIMIT = 4
  static readonly QUEUE_MAX_ENTRIES = 256
  static readonly IN_FLIGHT_MAX_ENTRIES = 256
  static readonly PROBE_TIMEOUT_MS = 15_000

  private readonly cache = new Map<string, ProviderMetadataCacheEntry>()
  private readonly inFlight = new Map<string, ProviderMetadataInFlightEntry>()
  private readonly activeProbes = new Set<Promise<ProviderMetadataCacheEntry>>()
  private readonly semaphore: BoundedAsyncSemaphore
  private readonly inFlightMaxEntries: number
  private readonly probeTimeoutMs: number

  constructor(limits: ProviderMetadataCacheLimits = {}) {
    this.semaphore = new BoundedAsyncSemaphore(
      boundedProviderLimit(
        limits.concurrencyLimit,
        ProviderMetadataCache.CONCURRENCY_LIMIT
      ),
      boundedProviderLimit(
        limits.queueMaxEntries,
        ProviderMetadataCache.QUEUE_MAX_ENTRIES
      )
    )
    this.inFlightMaxEntries = boundedProviderLimit(
      limits.inFlightMaxEntries,
      ProviderMetadataCache.IN_FLIGHT_MAX_ENTRIES
    )
    this.probeTimeoutMs =
      limits.probeTimeoutMs !== undefined &&
      Number.isFinite(limits.probeTimeoutMs)
        ? Math.max(1, Math.floor(limits.probeTimeoutMs))
        : ProviderMetadataCache.PROBE_TIMEOUT_MS
  }

  /**
   * A fresh cached entry is returned as is unless `force`. A non-forced read
   * joins any in-flight probe; a forced read joins only an in-flight *forced*
   * probe, otherwise it starts its own so the caller really does bypass the
   * cache. On failure of individual probes the previous entry's lists are
   * kept (see `readAdapterMetadata`).
   */
  async read(
    instance: {
      readonly instanceId: string
      readonly adapter: ProviderAdapterShape
    },
    cwd: string | null | undefined,
    options: { readonly force: boolean }
  ): Promise<ProviderMetadataCacheEntry> {
    const normalizedCwd = normalizeProviderMetadataCwd(cwd)
    const key = metadataCacheKey(instance.instanceId, normalizedCwd)
    const cached = this.cache.get(key)
    if (
      cached &&
      !options.force &&
      Date.now() - cached.checkedAt < ProviderMetadataCache.TTL_MS
    ) {
      return cached
    }

    const inFlight = this.inFlight.get(key)
    if (inFlight && (!options.force || inFlight.force)) {
      return inFlight.promise
    }

    if (!inFlight && this.inFlight.size >= this.inFlightMaxEntries) {
      throw new ProviderMetadataCapacityError()
    }

    const promise = this.semaphore.run(() =>
      readAdapterMetadata(instance.adapter, normalizedCwd, {
        force: options.force,
        previous: cached,
        timeoutMs: this.probeTimeoutMs,
      })
    )
    this.activeProbes.add(promise)
    this.inFlight.set(key, { force: options.force, promise })
    try {
      const next = await promise
      if (this.inFlight.get(key)?.promise === promise) {
        this.prune(key)
        this.cache.set(key, next)
      }
      return next
    } finally {
      this.activeProbes.delete(promise)
      if (this.inFlight.get(key)?.promise === promise) {
        this.inFlight.delete(key)
      }
    }
  }

  /**
   * Drops one cwd's entry (and any in-flight probe for it), or — with `cwd`
   * undefined — everything cached for the instance. `null` is a real cwd
   * (the "no cwd" bucket), not a wildcard.
   */
  invalidate(instanceId: string, cwd?: string | null): void {
    if (cwd === undefined) {
      this.invalidateInstance(instanceId)
      return
    }
    const key = metadataCacheKey(instanceId, cwd)
    this.cache.delete(key)
    this.inFlight.delete(key)
  }

  invalidateInstance(instanceId: string): void {
    const prefix = `${instanceId}\u0000`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.inFlight.delete(key)
    }
  }

  /** Forgets every instance that is not in the next registry generation. */
  retainInstances(instanceIds: ReadonlySet<string>): void {
    for (const key of this.cache.keys()) {
      if (!instanceIds.has(key.split("\u0000", 1)[0])) this.cache.delete(key)
    }
    for (const key of this.inFlight.keys()) {
      if (!instanceIds.has(key.split("\u0000", 1)[0]))
        this.inFlight.delete(key)
    }
  }

  /** Probes still running; shutdown drains these before stopping adapters. */
  inFlightPromises(): ReadonlyArray<Promise<unknown>> {
    return Array.from(this.activeProbes)
  }

  private prune(preserveKey: string): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (
        key !== preserveKey &&
        now - entry.checkedAt >= ProviderMetadataCache.TTL_MS
      ) {
        this.cache.delete(key)
      }
    }
    while (this.cache.size >= ProviderMetadataCache.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value as string | undefined
      if (!oldestKey) break
      this.cache.delete(oldestKey)
    }
  }
}

function withProbeDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      settle()
    }
    timer = setTimeout(() => {
      finish(() => reject(new Error("Provider metadata probe timed out.")))
    }, timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })
}

function metadataCacheKey(
  instanceId: string,
  cwd: string | null | undefined
): string {
  return `${instanceId}\u0000${providerMetadataCwdKey(cwd)}`
}

export function normalizeProviderMetadataCwd(
  cwd: string | null | undefined
): string | null {
  if (cwd === null || cwd === undefined) return null
  const normalized = cwd.trim()
  if (!normalized) return null
  if (normalized.length > 4_096 || normalized.includes("\u0000")) {
    throw new ProviderMetadataInputError()
  }
  return normalized
}

export function providerMetadataCwdKey(cwd: string | null | undefined): string {
  const normalized = normalizeProviderMetadataCwd(cwd)
  if (!normalized) return ""
  const absolute = path.resolve(normalized)
  return process.platform === "win32" ? absolute.toLowerCase() : absolute
}

export function boundedProviderLimit(
  requested: number | undefined,
  hardMaximum: number
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return hardMaximum
  }
  return Math.max(1, Math.min(hardMaximum, Math.floor(requested)))
}

async function readAdapterMetadata(
  adapter: ProviderAdapterShape,
  cwd: string | null | undefined,
  options: {
    readonly force: boolean
    readonly timeoutMs: number
    readonly previous?: ProviderMetadataCacheEntry
  }
): Promise<ProviderMetadataCacheEntry> {
  const probe = <T>(operation: Promise<T> | undefined, fallback: T): Promise<T> =>
    withProbeDeadline(operation ?? Promise.resolve(fallback), options.timeoutMs)
  const [
    providerCatalogResult,
    skillsResult,
    slashCommandsResult,
    agentsResult,
    toolsResult,
  ] = await Promise.allSettled([
    probe(
      adapter.availableProviderCatalog?.({ cwd, force: options.force }),
      [] as ReadonlyArray<ProviderCatalogEntry>
    ),
    probe(
      adapter.availableSkills?.({ cwd, force: options.force }),
      [] as ReadonlyArray<ProviderSkill>
    ),
    probe(
      adapter.availableSlashCommands?.({ cwd, force: options.force }),
      [] as ReadonlyArray<ProviderSlashCommand>
    ),
    probe(
      adapter.availableAgents?.({ cwd, force: options.force }),
      [] as ReadonlyArray<ProviderAgent>
    ),
    probe(
      adapter.availableTools?.({ cwd, force: options.force }),
      [] as ReadonlyArray<ProviderTool>
    ),
  ])
  return {
    checkedAt: Date.now(),
    providerCatalog:
      providerCatalogResult.status === "fulfilled"
        ? providerCatalogResult.value
        : (options.previous?.providerCatalog ?? []),
    skills:
      skillsResult.status === "fulfilled"
        ? skillsResult.value
        : (options.previous?.skills ?? []),
    agents:
      agentsResult.status === "fulfilled"
        ? agentsResult.value
        : (options.previous?.agents ?? []),
    tools:
      toolsResult.status === "fulfilled"
        ? toolsResult.value
        : (options.previous?.tools ?? []),
    slashCommands:
      slashCommandsResult.status === "fulfilled"
        ? slashCommandsResult.value
        : (options.previous?.slashCommands ?? []),
    ...(skillsResult.status === "rejected"
      ? { skillsError: "Provider skills could not be loaded." }
      : {}),
    ...(providerCatalogResult.status === "rejected"
      ? {
          providerCatalogError: "Provider catalog could not be loaded.",
        }
      : {}),
    ...(agentsResult.status === "rejected"
      ? { agentsError: "Provider agents could not be loaded." }
      : {}),
    ...(toolsResult.status === "rejected"
      ? { toolsError: "Provider tools could not be loaded." }
      : {}),
    ...(slashCommandsResult.status === "rejected"
      ? { slashCommandsError: "Provider slash commands could not be loaded." }
      : {}),
  }
}

export function toSnapshotMetadata(
  entry: ProviderMetadataCacheEntry
): ProviderInstanceMetadata {
  return {
    checkedAt: entry.checkedAt,
    ...(entry.skillsError ? { skillsError: entry.skillsError } : {}),
    ...(entry.providerCatalogError
      ? { providerCatalogError: entry.providerCatalogError }
      : {}),
    ...(entry.agentsError ? { agentsError: entry.agentsError } : {}),
    ...(entry.toolsError ? { toolsError: entry.toolsError } : {}),
    ...(entry.slashCommandsError
      ? { slashCommandsError: entry.slashCommandsError }
      : {}),
  }
}

/**
 * Merges the on-disk status cache into a freshly assembled snapshot and
 * writes the result back when the instance is healthy enough to be worth
 * remembering. Without a cache dir the snapshot passes through untouched.
 * The write is best-effort: a full disk must not fail provider listing.
 */
export async function hydrateAndPersistInstanceSnapshot<
  T extends CacheableProviderSnapshot,
>(statusCacheDir: string | null, fallbackProvider: T): Promise<T> {
  if (!statusCacheDir) return fallbackProvider
  const filePath = resolveProviderStatusCachePath({
    cacheDir: statusCacheDir,
    instanceId: fallbackProvider.instanceId,
  })
  const cachedProvider = await readProviderStatusCache(filePath)
  const hydratedProvider = cachedProvider
    ? hydrateCachedProviderSnapshot({
        cachedProvider,
        fallbackProvider,
      })
    : fallbackProvider
  if (
    hydratedProvider.enabled &&
    hydratedProvider.configured &&
    !hydratedProvider.unavailableReason
  ) {
    await writeProviderStatusCache({
      filePath,
      provider: hydratedProvider,
    }).catch(() => {})
  }
  return hydratedProvider
}
