/**
 * Simple circuit breaker for provider API calls.
 *
 * States:
 *   CLOSED    – normal operation, requests pass through.
 *   OPEN      – too many consecutive failures; requests are rejected immediately.
 *   HALF_OPEN – cool-down expired; one probe request is allowed through.
 *
 * One breaker is maintained per ProviderKind. The default thresholds are
 * 5 consecutive failures to open, and 30 seconds before transitioning to
 * HALF_OPEN.
 */

import type { ProviderKind } from "./types";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens (default 5). */
  failureThreshold?: number;
  /** Milliseconds the circuit stays open before moving to HALF_OPEN (default 30 000). */
  resetTimeoutMs?: number;
}

interface BreakerEntry {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
  /** L6: counts consecutive HALF_OPEN failures so a single transient blip
   *  doesn't immediately re-open the circuit and force another full
   *  cooldown.  Reset to 0 on every successful probe. */
  halfOpenFailures: number;
  generation: number;
  probeInFlight: boolean;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
/** L6: tolerate this many consecutive failures in HALF_OPEN before re-opening
 *  the circuit.  Two probes is the sweet spot — one might be a transient
 *  network blip; two in a row says the upstream really is still down. */
const HALF_OPEN_TOLERANCE = 2;

const breakers = new Map<ProviderKind, BreakerEntry>();

let failureThreshold = DEFAULT_FAILURE_THRESHOLD;
let resetTimeoutMs = DEFAULT_RESET_TIMEOUT_MS;

function getEntry(provider: ProviderKind): BreakerEntry {
  let entry = breakers.get(provider);
  if (!entry) {
    entry = {
      state: CircuitState.CLOSED,
      failures: 0,
      lastFailureTime: 0,
      halfOpenFailures: 0,
      generation: 0,
      probeInFlight: false,
    };
    breakers.set(provider, entry);
  }
  return entry;
}

/** Visible for testing — returns the current state for a given provider. */
export function getState(provider: ProviderKind): CircuitState {
  const entry = getEntry(provider);

  // Transition from OPEN -> HALF_OPEN when the timeout has elapsed.
  if (
    entry.state === CircuitState.OPEN &&
    Date.now() - entry.lastFailureTime >= resetTimeoutMs
  ) {
    entry.state = CircuitState.HALF_OPEN;
  }

  return entry.state;
}

/** Returns how many seconds remain until the circuit moves to HALF_OPEN (0 when not OPEN). */
export function remainingCooldownSec(provider: ProviderKind): number {
  const entry = getEntry(provider);
  if (entry.state !== CircuitState.OPEN) return 0;
  const elapsed = Date.now() - entry.lastFailureTime;
  const remaining = resetTimeoutMs - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Wraps an async provider call with the circuit breaker logic.
 *
 * @param provider  The provider kind whose breaker to consult.
 * @param fn        The actual async work (e.g. `adapter.sendMessage(input)`).
 * @returns         The result of `fn` on success.
 * @throws          `CircuitOpenError` when the circuit is OPEN.
 *                  Re-throws the original error on a regular failure.
 */
export async function withCircuitBreaker<T>(
  provider: ProviderKind,
  fn: () => Promise<T>,
): Promise<T> {
  const entry = getEntry(provider);

  // Possibly advance OPEN -> HALF_OPEN.
  if (
    entry.state === CircuitState.OPEN &&
    Date.now() - entry.lastFailureTime >= resetTimeoutMs
  ) {
    entry.state = CircuitState.HALF_OPEN;
  }

  // Reject immediately when OPEN.
  if (entry.state === CircuitState.OPEN) {
    const secs = remainingCooldownSec(provider);
    throw new CircuitOpenError(provider, secs);
  }

  const isProbe = entry.state === CircuitState.HALF_OPEN;
  if (isProbe && entry.probeInFlight) {
    throw new CircuitOpenError(provider, 0);
  }
  const generation = entry.generation;
  if (isProbe) entry.probeInFlight = true;

  try {
    const result = await fn();

    // Success — close the circuit (handles both CLOSED and HALF_OPEN).
    // Calls admitted before an opening must not alter the recovery state.
    if (generation === entry.generation) {
      entry.state = CircuitState.CLOSED;
      entry.failures = 0;
      entry.halfOpenFailures = 0;
    }

    return result;
  } catch (err) {
    if (generation !== entry.generation) throw err;
    entry.failures += 1;
    entry.lastFailureTime = Date.now();

    if (entry.state === CircuitState.HALF_OPEN) {
      // L6: tolerate transient blips. Re-open only after we hit the
      // half-open failure budget.
      entry.halfOpenFailures += 1;
      if (entry.halfOpenFailures >= HALF_OPEN_TOLERANCE) {
        entry.state = CircuitState.OPEN;
        entry.halfOpenFailures = 0;
        entry.generation += 1;
      }
    } else if (entry.failures >= failureThreshold) {
      entry.state = CircuitState.OPEN;
      entry.halfOpenFailures = 0;
      entry.generation += 1;
    }

    throw err;
  } finally {
    if (isProbe) entry.probeInFlight = false;
  }
}

/** Thrown when a call is rejected because the circuit is OPEN. */
export class CircuitOpenError extends Error {
  constructor(
    public readonly provider: ProviderKind,
    public readonly retryInSec: number,
  ) {
    super(
      `Provider temporarily unavailable — too many recent failures. Retrying in ${retryInSec}s.`,
    );
    this.name = "CircuitOpenError";
  }
}

// ---------------------------------------------------------------------------
// Test helpers — reset state between tests or reconfigure thresholds.
// ---------------------------------------------------------------------------

export function _resetAll(): void {
  breakers.clear();
}

export function _configure(opts: CircuitBreakerOptions): void {
  failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  resetTimeoutMs = opts.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
}
