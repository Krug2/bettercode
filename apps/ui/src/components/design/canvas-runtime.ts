import type { ThreadActivity } from "@betterc0de/schema"
import { isRecord, readNumber, readString } from "@betterc0de/schema"
import { payloadToolId } from "@/lib/provider-events/payload"

/**
 * Pure derivations behind the runtime pane: the request log a preview guest
 * produced, the endpoints it implies, and the agent's tool runs folded from
 * thread activities. No React, no stores.
 */

/** One finished request of a preview guest, as the shell reports it. */
export interface PreviewRequestEntry {
  readonly id: string
  readonly webContentsId: number
  readonly method: string
  readonly url: string
  readonly resourceType: string
  readonly startedAt: number
  readonly durationMs: number
  readonly statusCode: number | null
  readonly fromCache: boolean
  readonly error: string | null
}

export function parsePreviewRequest(raw: unknown): PreviewRequestEntry | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, "id")
  const url = readString(raw, "url")
  const webContentsId = readNumber(raw, "webContentsId")
  if (!id || !url || webContentsId === undefined) return null
  return {
    id,
    webContentsId,
    method: (readString(raw, "method") ?? "GET").toUpperCase(),
    url,
    resourceType: readString(raw, "resourceType") ?? "other",
    startedAt: readNumber(raw, "startedAt") ?? Date.now(),
    durationMs: Math.max(0, readNumber(raw, "durationMs") ?? 0),
    statusCode: readNumber(raw, "statusCode") ?? null,
    fromCache: raw.fromCache === true,
    error: readString(raw, "error") ?? null,
  }
}

/** Resource types that are API traffic rather than page loads. */
const API_RESOURCE_TYPES = new Set(["xhr", "fetch", "ping", "webSocket"])

export function isDevelopmentRequest(entry: PreviewRequestEntry): boolean {
  try {
    // Match the path, not query parameters; base-path deployments are included.
    return /(?:^|\/)_next\/(?:hmr|webpack-hmr)(?:\/|$)/.test(
      new URL(entry.url).pathname
    )
  } catch {
    return false
  }
}

export function isApiRequest(entry: PreviewRequestEntry): boolean {
  return (
    API_RESOURCE_TYPES.has(entry.resourceType) && !isDevelopmentRequest(entry)
  )
}

/** Appends and keeps the newest `cap` items; the array identity changes only when something was added. */
export function appendCapped<T>(
  list: readonly T[],
  items: readonly T[],
  cap: number
): T[] {
  if (items.length === 0) return list as T[]
  const next = [...list, ...items]
  return next.length > cap ? next.slice(next.length - cap) : next
}

export interface EndpointSummary {
  readonly key: string
  readonly method: string
  readonly origin: string
  readonly path: string
  readonly count: number
  readonly lastStatus: number | null
  readonly lastError: string | null
  readonly averageMs: number
  readonly lastAt: number
  /** The most recent full URL, query string included, for a replay. */
  readonly lastUrl: string
}

/**
 * The distinct `METHOD path` pairs the guest called, newest first. Query
 * strings are folded away so `/api/items?page=2` counts as `/api/items`.
 */
export function groupEndpoints(
  entries: readonly PreviewRequestEntry[]
): EndpointSummary[] {
  const groups = new Map<string, { sum: number; summary: EndpointSummary }>()
  for (const entry of entries) {
    let origin = ""
    let path = entry.url
    try {
      const parsed = new URL(entry.url)
      origin = parsed.origin
      path = parsed.pathname
    } catch {
      /* A malformed URL still counts as an endpoint under its raw text. */
    }
    const key = `${entry.method} ${origin}${path}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        sum: entry.durationMs,
        summary: {
          key,
          method: entry.method,
          origin,
          path,
          count: 1,
          lastStatus: entry.statusCode,
          lastError: entry.error,
          averageMs: entry.durationMs,
          lastAt: entry.startedAt,
          lastUrl: entry.url,
        },
      })
      continue
    }
    existing.sum += entry.durationMs
    const count = existing.summary.count + 1
    const newer = entry.startedAt >= existing.summary.lastAt
    existing.summary = {
      ...existing.summary,
      count,
      averageMs: Math.round(existing.sum / count),
      ...(newer
        ? {
            lastStatus: entry.statusCode,
            lastError: entry.error,
            lastAt: entry.startedAt,
            lastUrl: entry.url,
          }
        : {}),
    }
  }
  return [...groups.values()]
    .map((group) => group.summary)
    .sort((a, b) => b.lastAt - a.lastAt)
}

/** Replaying a request must not repeat a mutation; only reads are offered. */
export function canReplayEndpoint(
  endpoint: Pick<EndpointSummary, "method">
): boolean {
  return endpoint.method === "GET" || endpoint.method === "HEAD"
}

/** The script a viewport runs to replay a read from inside the page. */
export function replayScript(url: string): string {
  return `fetch(${JSON.stringify(url)}, { credentials: "include" }).then((r) => r.status).catch(() => null)`
}

export type ToolRunStatus = "running" | "completed" | "failed" | "denied"

export interface ToolRun {
  readonly toolId: string
  readonly summary: string
  readonly status: ToolRunStatus
  readonly startedAt: string
  readonly endedAt: string | null
}

const TOOL_KINDS: Record<string, ToolRunStatus | "update"> = {
  "tool.started": "running",
  "tool.updated": "update",
  "tool.progress": "update",
  "tool.completed": "completed",
  "tool.failed": "failed",
  "tool.denied": "denied",
}

/**
 * Folds a thread's `tool.*` activities into one row per tool run, newest
 * first. An update never resets a terminal state, so a late `tool.updated`
 * after `tool.completed` keeps the run finished.
 */
export function foldToolActivities(
  activities: readonly ThreadActivity[]
): ToolRun[] {
  const runs = new Map<string, ToolRun>()
  for (const activity of activities) {
    const kindStatus = TOOL_KINDS[activity.kind]
    if (!kindStatus) continue
    const payload = isRecord(activity.payload) ? activity.payload : {}
    const toolId = payloadToolId(payload) ?? activity.id
    const existing = runs.get(toolId)
    if (!existing) {
      runs.set(toolId, {
        toolId,
        summary: activity.summary,
        status: kindStatus === "update" ? "running" : kindStatus,
        startedAt: activity.createdAt,
        endedAt:
          kindStatus === "update" || kindStatus === "running"
            ? null
            : activity.createdAt,
      })
      continue
    }
    if (kindStatus === "update" || kindStatus === "running") {
      if (
        existing.status === "running" &&
        activity.summary &&
        existing.summary === ""
      )
        runs.set(toolId, { ...existing, summary: activity.summary })
      continue
    }
    runs.set(toolId, {
      ...existing,
      status: kindStatus,
      endedAt: activity.createdAt,
      summary:
        activity.kind === "tool.denied" ? activity.summary : existing.summary,
    })
  }
  return [...runs.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  )
}

export function formatMillis(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}
