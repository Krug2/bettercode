/**
 * Live model discovery for Anthropic providers.
 *
 * Every other CLI provider in the app learns its model list at runtime (Codex
 * over `model/list`, Cursor and Grok over ACP config options). Anthropic was
 * the sole exception: its list was compiled in, so each new release meant a
 * code change in a dozen files and, until that shipped, the newest model was
 * simply unavailable.
 *
 * This module closes that gap by reading Anthropic's public models endpoint and
 * merging anything genuinely new over the curated list. The curated entries
 * still win — they carry reviewed display names, ordering and capabilities —
 * so discovery only ever *adds* releases that postdate the build.
 */

import { createHash } from "node:crypto"
import {
  compareAnthropicModelIds,
  parseAnthropicModelId,
} from "@betterc0de/schema"

export interface DiscoveredAnthropicModel {
  readonly id: string
  readonly displayName: string | null
}

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
const ANTHROPIC_VERSION_HEADER = "2023-06-01"
const DISCOVERY_TTL_MS = 6 * 60 * 60_000
/** Bounded so a hung endpoint can never delay a provider list. */
const DISCOVERY_TIMEOUT_MS = 5_000
const MAX_PAGES = 5

interface DiscoveryCacheEntry {
  readonly models: ReadonlyArray<DiscoveredAnthropicModel>
  readonly fetchedAt: number
}

/** Keyed by API key so switching accounts cannot serve another key's list. */
const cache = new Map<string, DiscoveryCacheEntry>()
const inFlight = new Map<string, Promise<void>>()

export function __resetAnthropicModelDiscoveryForTests(): void {
  cache.clear()
  inFlight.clear()
}

function cacheKey(apiKey: string): string {
  // Distinguish the complete credential without retaining it in the cache.
  return createHash("sha256").update(apiKey).digest("hex")
}

async function fetchAnthropicModelPage(
  apiKey: string,
  afterId: string | null,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<{
  models: DiscoveredAnthropicModel[]
  hasMore: boolean
  lastId: string | null
}> {
  const url = new URL(ANTHROPIC_MODELS_URL)
  url.searchParams.set("limit", "100")
  if (afterId) url.searchParams.set("after_id", afterId)
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION_HEADER,
    },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Anthropic model list failed with ${response.status}`)
  }
  const payload = (await response.json()) as {
    data?: ReadonlyArray<{
      id?: unknown
      display_name?: unknown
    }>
    has_more?: unknown
    last_id?: unknown
  }
  const models: DiscoveredAnthropicModel[] = []
  for (const entry of payload.data ?? []) {
    if (typeof entry?.id !== "string" || !entry.id.trim()) continue
    models.push({
      id: entry.id.trim(),
      displayName:
        typeof entry.display_name === "string" && entry.display_name.trim()
          ? entry.display_name.trim()
          : null,
    })
  }
  return {
    models,
    hasMore: payload.has_more === true,
    lastId: typeof payload.last_id === "string" ? payload.last_id : null,
  }
}

export async function fetchAnthropicModels(
  apiKey: string,
  options: { readonly fetchImpl?: typeof fetch } = {}
): Promise<DiscoveredAnthropicModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const collected: DiscoveredAnthropicModel[] = []
    let afterId: string | null = null
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await fetchAnthropicModelPage(
        apiKey,
        afterId,
        fetchImpl,
        controller.signal
      )
      collected.push(...result.models)
      if (!result.hasMore || !result.lastId) break
      afterId = result.lastId
    }
    return collected
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Refreshes the cache in the background when it is stale. Callers are
 * synchronous list builders, so this deliberately does not block them: the
 * first call after a cold start returns the curated list and the next poll
 * (the UI refreshes provider instances every 30s) picks up the result.
 */
export function scheduleAnthropicModelDiscovery(
  apiKey: string | null | undefined,
  options: {
    readonly fetchImpl?: typeof fetch
    readonly onError?: (error: unknown) => void
    readonly now?: () => number
  } = {}
): void {
  const key = apiKey?.trim()
  if (!key) return
  const id = cacheKey(key)
  if (inFlight.has(id)) return
  const now = options.now?.() ?? Date.now()
  const cached = cache.get(id)
  if (cached && now - cached.fetchedAt < DISCOVERY_TTL_MS) return

  const run = fetchAnthropicModels(key, options)
    .then((models) => {
      cache.set(id, { models, fetchedAt: options.now?.() ?? Date.now() })
    })
    .catch((error) => {
      // A missing model list must never break the picker; keep serving the
      // curated one and retry after the TTL rather than hammering the API.
      cache.set(id, {
        models: cache.get(id)?.models ?? [],
        fetchedAt: options.now?.() ?? Date.now(),
      })
      options.onError?.(error)
    })
    .finally(() => {
      inFlight.delete(id)
    })
  inFlight.set(id, run)
}

export function getDiscoveredAnthropicModels(
  apiKey: string | null | undefined
): ReadonlyArray<DiscoveredAnthropicModel> {
  const key = apiKey?.trim()
  if (!key) return []
  return cache.get(cacheKey(key))?.models ?? []
}

/**
 * Keeps a discovered model only when it is a genuinely newer release than
 * anything curated for its family, or when its family is new entirely. Without
 * this the endpoint's full history (Claude 2, Claude 3, dated snapshots) would
 * flood the picker with models nobody wants to pick.
 */
export function selectNewAnthropicModels(
  curatedSlugs: ReadonlyArray<string>,
  discovered: ReadonlyArray<DiscoveredAnthropicModel>
): DiscoveredAnthropicModel[] {
  const curatedIds = new Set(curatedSlugs.map((slug) => slug.toLowerCase()))
  const newestCuratedByFamily = new Map<string, number>()
  for (const slug of curatedSlugs) {
    const identity = parseAnthropicModelId(slug)
    if (!identity || identity.version === null) continue
    const current = newestCuratedByFamily.get(identity.family)
    if (current === undefined || identity.version > current) {
      newestCuratedByFamily.set(identity.family, identity.version)
    }
  }

  const seen = new Set<string>()
  const kept: DiscoveredAnthropicModel[] = []
  for (const model of discovered) {
    const id = model.id.toLowerCase()
    if (curatedIds.has(id) || seen.has(id)) continue
    const identity = parseAnthropicModelId(model.id)
    if (!identity || identity.version === null) continue
    const newestCurated = newestCuratedByFamily.get(identity.family)
    if (newestCurated !== undefined && identity.version <= newestCurated) {
      continue
    }
    seen.add(id)
    kept.push(model)
  }
  return kept.sort((a, b) => compareAnthropicModelIds(a.id, b.id))
}
