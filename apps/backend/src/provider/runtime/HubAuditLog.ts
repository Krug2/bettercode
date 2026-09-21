import type { ProviderRuntimeEvent } from "./contracts"
import type { EventNdjsonLogger } from "./EventNdjsonLogger"
import {
  backendMetrics,
  PROVIDER_RUNTIME_EVENTS_TOTAL,
} from "../../observability/metrics"

/**
 * Observability side of the hub's event lane: the canonical NDJSON trace and
 * the per-event metric counter. Both are best-effort — provider runtime
 * delivery must never depend on an observability disk write — so `write`
 * swallows logger failures instead of letting them reach the adapter's emit
 * loop.
 */
export class HubAuditLog {
  constructor(private readonly canonicalEventLogger: EventNdjsonLogger | null) {}

  write(event: ProviderRuntimeEvent): void {
    try {
      this.canonicalEventLogger?.write(event, event.threadId)
    } catch {
      // The logger is intentionally best-effort; provider runtime delivery
      // must not depend on observability disk writes.
    }
  }

  recordMetric(event: ProviderRuntimeEvent): void {
    backendMetrics.incrementCounter(PROVIDER_RUNTIME_EVENTS_TOTAL, {
      provider: event.provider ?? event.providerKind ?? "unknown",
      eventType: event.type,
    })
  }

  /** Called once from the hub's shutdown path; safe without a logger. */
  close(): void {
    this.canonicalEventLogger?.close()
  }
}
