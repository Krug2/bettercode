export type MetricAttributes = Readonly<Record<string, unknown>>
export type MetricOutcome = "success" | "failure"

export interface CounterMetricSnapshot {
  readonly type: "counter"
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly value: number
}

export interface TimerMetricSnapshot {
  readonly type: "timer"
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly count: number
  readonly sumMs: number
  readonly minMs: number
  readonly maxMs: number
}

export type MetricSnapshot = CounterMetricSnapshot | TimerMetricSnapshot

export const RPC_REQUESTS_TOTAL = "betterc0de_rpc_requests_total"
export const RPC_REQUEST_DURATION_MS = "betterc0de_rpc_request_duration_ms"
export const HTTP_REQUESTS_TOTAL = "betterc0de_http_requests_total"
export const HTTP_REQUEST_DURATION_MS = "betterc0de_http_request_duration_ms"
export const PROVIDER_TURNS_TOTAL = "betterc0de_provider_turns_total"
export const PROVIDER_TURN_DURATION_MS = "betterc0de_provider_turn_duration_ms"
export const PROVIDER_RUNTIME_EVENTS_TOTAL =
  "betterc0de_provider_runtime_events_total"
export const PROVIDER_JOURNAL_EVENTS_TOTAL =
  "betterc0de_provider_journal_events_total"
export const PROVIDER_TRANSCRIPT_SNAPSHOTS_TOTAL =
  "betterc0de_provider_transcript_snapshots_total"
export const PROVIDER_TRANSCRIPT_SNAPSHOT_BYTES_TOTAL =
  "betterc0de_provider_transcript_snapshot_bytes_total"

interface TimerState {
  count: number
  sumMs: number
  minMs: number
  maxMs: number
}

export interface InMemoryMetricsOptions {
  /** Hard cap per metric type. New cardinality is folded into overflow series. */
  readonly maxSeries?: number
}

export class InMemoryMetrics {
  private readonly counters = new Map<string, CounterMetricSnapshot>()
  private readonly timers = new Map<string, TimerMetricSnapshot>()
  private readonly maxSeries: number

  constructor(options: InMemoryMetricsOptions = {}) {
    this.maxSeries = Math.max(1, Math.floor(options.maxSeries ?? 2_000))
  }

  incrementCounter(
    name: string,
    attributes: MetricAttributes = {},
    amount = 1
  ): void {
    const compacted = compactMetricAttributes(attributes)
    const resolved = this.resolveSeries(this.counters, name, compacted)
    const key = resolved.key
    const previous = this.counters.get(key)
    this.counters.set(key, {
      type: "counter",
      name,
      attributes: resolved.attributes,
      value: (previous?.value ?? 0) + amount,
    })
  }

  recordDuration(
    name: string,
    durationMs: number,
    attributes: MetricAttributes = {}
  ): void {
    const compacted = compactMetricAttributes(attributes)
    const resolved = this.resolveSeries(this.timers, name, compacted)
    const key = resolved.key
    const previous = this.timers.get(key)
    const state = nextTimerState(previous, durationMs)
    this.timers.set(key, {
      type: "timer",
      name,
      attributes: resolved.attributes,
      ...state,
    })
  }

  snapshot(): MetricSnapshot[] {
    return [
      ...Array.from(this.counters.values()),
      ...Array.from(this.timers.values()),
    ].sort((left, right) => {
      const nameOrder = left.name.localeCompare(right.name)
      if (nameOrder !== 0) return nameOrder
      return stableStringify(left.attributes).localeCompare(
        stableStringify(right.attributes)
      )
    })
  }

  reset(): void {
    this.counters.clear()
    this.timers.clear()
  }

  private resolveSeries<T>(
    series: Map<string, T>,
    name: string,
    attributes: Readonly<Record<string, string>>,
  ): { key: string; attributes: Readonly<Record<string, string>> } {
    const key = metricKey(name, attributes)
    if (series.has(key) || series.size < this.maxSeries) {
      return { key, attributes }
    }

    const overflowAttributes = { overflow: "true" } as const
    const overflowKey = metricKey(name, overflowAttributes)
    if (!series.has(overflowKey) && series.size >= this.maxSeries) {
      const oldestKey = series.keys().next().value
      if (oldestKey !== undefined) series.delete(oldestKey)
    }
    return { key: overflowKey, attributes: overflowAttributes }
  }
}

export const backendMetrics = new InMemoryMetrics()

export function providerTurnMetricAttributes(input: {
  readonly provider: string
  readonly model: string | null | undefined
  readonly instanceId?: string | null
  readonly extra?: MetricAttributes
}): MetricAttributes {
  const modelFamily = normalizeModelMetricLabel(input.model)
  return {
    provider: input.provider,
    ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    ...(modelFamily ? { modelFamily } : {}),
    ...(input.extra ?? {}),
  }
}

export async function observeAsync<T>(
  options: {
    readonly counterName?: string
    readonly timerName?: string
    readonly attributes?: MetricAttributes | (() => MetricAttributes)
    readonly metrics?: InMemoryMetrics
    readonly now?: () => number
  },
  fn: () => Promise<T> | T
): Promise<T> {
  const metrics = options.metrics ?? backendMetrics
  const now = options.now ?? (() => performance.now())
  const startedAt = now()
  try {
    const value = await fn()
    recordObservedMetrics(metrics, options, now() - startedAt, "success")
    return value
  } catch (error) {
    recordObservedMetrics(metrics, options, now() - startedAt, "failure")
    throw error
  }
}

export function compactMetricAttributes(
  attributes: MetricAttributes
): Readonly<Record<string, string>> {
  const compacted: Record<string, string> = {}
  for (const [rawKey, value] of Object.entries(attributes).slice(0, 16)) {
    if (value === null || value === undefined || value === "") continue
    const key = rawKey.slice(0, 64)
    compacted[key] = String(value).slice(0, 128)
  }
  return compacted
}

function recordObservedMetrics(
  metrics: InMemoryMetrics,
  options: {
    readonly counterName?: string
    readonly timerName?: string
    readonly attributes?: MetricAttributes | (() => MetricAttributes)
  },
  rawDurationMs: number,
  outcome: MetricOutcome
): void {
  const attributes =
    typeof options.attributes === "function"
      ? options.attributes()
      : (options.attributes ?? {})
  const durationMs = Number.isFinite(rawDurationMs)
    ? Math.max(0, rawDurationMs)
    : 0

  if (options.timerName) {
    metrics.recordDuration(options.timerName, durationMs, attributes)
  }
  if (options.counterName) {
    metrics.incrementCounter(options.counterName, { ...attributes, outcome })
  }
}

function nextTimerState(
  previous: TimerMetricSnapshot | undefined,
  durationMs: number
): TimerState {
  if (!previous) {
    return {
      count: 1,
      sumMs: durationMs,
      minMs: durationMs,
      maxMs: durationMs,
    }
  }
  return {
    count: previous.count + 1,
    sumMs: previous.sumMs + durationMs,
    minMs: Math.min(previous.minMs, durationMs),
    maxMs: Math.max(previous.maxMs, durationMs),
  }
}

function metricKey(
  name: string,
  attributes: Readonly<Record<string, string>>
): string {
  return `${name}:${stableStringify(attributes)}`
}

function stableStringify(value: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    )
  )
}

function normalizeModelMetricLabel(
  model: string | null | undefined
): string | undefined {
  const normalized = model?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes("gpt")) return "gpt"
  if (
    normalized.includes("claude") ||
    normalized.includes("opus") ||
    normalized.includes("sonnet")
  ) {
    return "claude"
  }
  if (normalized.includes("gemini")) return "gemini"
  return "other"
}
