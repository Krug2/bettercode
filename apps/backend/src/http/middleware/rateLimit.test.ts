import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to capacity tokens immediately, then denies", () => {
    const rl = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(true);
    const fourth = rl.consume("k");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time at the configured rate", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSecond: 10 });
    rl.consume("k"); // 1 left
    rl.consume("k"); // 0 left
    expect(rl.consume("k").allowed).toBe(false);
    // 1 token = 100ms at 10/s
    vi.advanceTimersByTime(100);
    expect(rl.consume("k").allowed).toBe(true);
  });

  it("retryAfterMs reports the wait until next token", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 10 });
    expect(rl.consume("k").allowed).toBe(true);
    const denied = rl.consume("k");
    expect(denied.allowed).toBe(false);
    // 1 token / 10 per second = 100ms
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(100);
  });

  it("isolates buckets per key", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(rl.consume("a").allowed).toBe(true);
    // Different key gets its own bucket.
    expect(rl.consume("b").allowed).toBe(true);
    // Same key is denied.
    expect(rl.consume("a").allowed).toBe(false);
    expect(rl.consume("b").allowed).toBe(false);
  });

  it("caps refill at capacity (no overflow)", () => {
    const rl = createRateLimiter({ capacity: 5, refillPerSecond: 100 });
    // Drain 3 tokens.
    rl.consume("k");
    rl.consume("k");
    rl.consume("k");
    // Wait long enough to refill many tokens.
    vi.advanceTimersByTime(60_000);
    // Should be back to full capacity, not above.
    for (let i = 0; i < 5; i++) {
      expect(rl.consume("k").allowed).toBe(true);
    }
    expect(rl.consume("k").allowed).toBe(false);
  });

  it("evicts oldest key once maxKeys is exceeded", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 1, maxKeys: 2 });
    rl.consume("a"); // a inserted
    rl.consume("b"); // b inserted
    expect(rl.size()).toBe(2);
    rl.consume("c"); // a evicted, c inserted
    expect(rl.size()).toBe(2);
    // a should now be a fresh bucket again, not denied.
    expect(rl.consume("a").allowed).toBe(true);
  });

  it("evicts the least recently used key, not the least recently inserted", () => {
    const rl = createRateLimiter({ capacity: 5, refillPerSecond: 1, maxKeys: 2 });
    rl.consume("a"); // a inserted (4 left)
    rl.consume("b"); // b inserted
    rl.consume("a"); // a touched again → b is now the LRU victim (a has 3 left)
    rl.consume("c"); // evicts b, not a
    expect(rl.size()).toBe(2);
    // a kept its drained bucket; b comes back fresh.
    expect(rl.consume("a").remaining).toBe(2);
    expect(rl.consume("b").remaining).toBe(4);
  });

  it("reset() clears all buckets", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    rl.consume("k");
    expect(rl.consume("k").allowed).toBe(false);
    rl.reset();
    expect(rl.size()).toBe(0);
    expect(rl.consume("k").allowed).toBe(true);
  });

  it("rejects invalid options", () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => createRateLimiter({ capacity: -1, refillPerSecond: 1 })).toThrow();
    expect(() => createRateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
    expect(() => createRateLimiter({ capacity: 1, refillPerSecond: -1 })).toThrow();
  });
});
