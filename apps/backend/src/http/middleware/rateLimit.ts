/**
 * Token-bucket rate limiter, in-process, no external dependencies.
 *
 * Each key has its own bucket of `capacity` tokens that refill at
 * `refillPerSecond`. `consume(key)` either takes one token and returns
 * `{allowed: true}`, or returns `{allowed: false, retryAfterMs}` describing
 * when the next token would land. Bucket count is capped (LRU on insert)
 * so a malicious caller cycling identifiers can't grow memory unbounded.
 *
 * Used to protect expensive shell endpoints (`/shell/run`, `/shell/abort`)
 * from spam — a compromised renderer or runaway agent should not be able
 * to invoke shell execution at unbounded rate even after passing the
 * permission gate.
 */
import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  /** Max tokens per key — also the burst capacity. */
  capacity: number;
  /** Tokens replenished per second. */
  refillPerSecond: number;
  /** Cap on the number of distinct keys tracked. Default 10_000. */
  maxKeys?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until at least one token would be available. 0 if allowed. */
  retryAfterMs: number;
  /** Whole tokens left in the bucket after this consume call (0 when denied). */
  remaining: number;
}

export interface RateLimiter {
  consume: (key: string) => RateLimitResult;
  /** Reset all buckets — for tests / teardown. */
  reset: () => void;
  /** Number of currently tracked keys — for tests / observability. */
  size: () => number;
}

/**
 * Hono middleware form: one bucket per `key(c)`, `429` with `Retry-After`
 * when it is empty. Keep the key stable per caller (identity or peer), never
 * caller-supplied body fields, or the limiter is trivially evaded.
 */
export function rateLimitMiddleware(
  limiter: RateLimiter,
  options: {
    key: (c: Context) => string;
    message: string;
  },
): MiddlewareHandler {
  return async (c, next) => {
    const result = limiter.consume(options.key(c));
    if (result.allowed) return next();
    c.header(
      "Retry-After",
      String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
    );
    return c.json(
      {
        error: options.message,
        code: "rate_limited",
        retryAfterMs: result.retryAfterMs,
      },
      429,
    );
  };
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  if (opts.capacity <= 0) {
    throw new Error("rateLimit: capacity must be > 0");
  }
  if (opts.refillPerSecond <= 0) {
    throw new Error("rateLimit: refillPerSecond must be > 0");
  }
  const capacity = opts.capacity;
  const refillRatePerMs = opts.refillPerSecond / 1000;
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  function consume(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      // LRU eviction on insert. Map iteration order is insertion order and
      // every access below re-inserts its key, so the first key is the least
      // recently used and is dropped first.
      if (buckets.size >= maxKeys) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      bucket = { tokens: capacity, updatedAt: now };
      buckets.set(key, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.updatedAt);
      const refilled = elapsed * refillRatePerMs;
      bucket.tokens = Math.min(capacity, bucket.tokens + refilled);
      bucket.updatedAt = now;
      // Move to the tail so a hot key is never the eviction victim.
      buckets.delete(key);
      buckets.set(key, bucket);
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0, remaining: Math.floor(bucket.tokens) };
    }
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(tokensNeeded / refillRatePerMs);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  function reset(): void { buckets.clear(); }
  function size(): number { return buckets.size; }

  return { consume, reset, size };
}
