import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  withCircuitBreaker,
  getState,
  CircuitState,
  CircuitOpenError,
  _resetAll,
  _configure,
} from "./circuitBreaker";

const PROVIDER = "openai" as const;

beforeEach(() => {
  _resetAll();
  _configure({ failureThreshold: 3, resetTimeoutMs: 1_000 });
  vi.restoreAllMocks();
});

describe("circuitBreaker", () => {
  it("stays CLOSED on successful calls", async () => {
    await withCircuitBreaker(PROVIDER, async () => "ok");
    await withCircuitBreaker(PROVIDER, async () => "ok");
    expect(getState(PROVIDER)).toBe(CircuitState.CLOSED);
  });

  it("opens after N consecutive failures", async () => {
    const err = new Error("boom");

    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    expect(getState(PROVIDER)).toBe(CircuitState.OPEN);
  });

  it("rejects immediately when OPEN", async () => {
    const err = new Error("boom");

    // Trip the breaker.
    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    // Next call should be rejected without invoking fn.
    const fn = vi.fn();
    await expect(withCircuitBreaker(PROVIDER, fn)).rejects.toThrow(
      CircuitOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions to HALF_OPEN after the reset timeout", async () => {
    const err = new Error("boom");

    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    expect(getState(PROVIDER)).toBe(CircuitState.OPEN);

    // Advance time past the reset timeout.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_500);

    expect(getState(PROVIDER)).toBe(CircuitState.HALF_OPEN);
  });

  it("closes again on a successful HALF_OPEN probe", async () => {
    const err = new Error("boom");

    // Open the circuit.
    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    // Jump past the reset timeout so the next call is a HALF_OPEN probe.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_500);

    await withCircuitBreaker(PROVIDER, async () => "recovered");
    expect(getState(PROVIDER)).toBe(CircuitState.CLOSED);
  });

  it("admits only one HALF_OPEN probe at a time", async () => {
    _configure({ failureThreshold: 1, resetTimeoutMs: 1_000 });
    await expect(withCircuitBreaker(PROVIDER, async () => { throw new Error("down"); })).rejects.toThrow("down");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_500);
    let finishProbe!: () => void;
    const probe = withCircuitBreaker(PROVIDER, () => new Promise<void>((resolve) => { finishProbe = resolve; }));
    const extra = vi.fn(async () => "extra");
    await expect(withCircuitBreaker(PROVIDER, extra)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(extra).not.toHaveBeenCalled();
    finishProbe();
    await probe;
    expect(getState(PROVIDER)).toBe(CircuitState.CLOSED);
  });

  it.each(["success", "failure"])("ignores late CLOSED-call %s after the breaker opens", async (outcome) => {
    _configure({ failureThreshold: 1, resetTimeoutMs: 1_000 });
    let finishOld!: () => void;
    const old = withCircuitBreaker(PROVIDER, () => new Promise<void>((resolve, reject) => {
      finishOld = () => outcome === "success" ? resolve() : reject(new Error("old failure"));
    }));
    const observedOld = old.catch(() => undefined);
    await expect(withCircuitBreaker(PROVIDER, async () => { throw new Error("down"); })).rejects.toThrow("down");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_500);
    let finishProbe!: () => void;
    const probe = withCircuitBreaker(PROVIDER, () => new Promise<void>((_resolve, reject) => {
      finishProbe = () => reject(new Error("probe failure"));
    }));
    finishOld();
    await observedOld;
    expect(getState(PROVIDER)).toBe(CircuitState.HALF_OPEN);
    finishProbe();
    await expect(probe).rejects.toThrow("probe failure");
    expect(getState(PROVIDER)).toBe(CircuitState.HALF_OPEN);
    await withCircuitBreaker(PROVIDER, async () => "recovered");
    expect(getState(PROVIDER)).toBe(CircuitState.CLOSED);
  });

  // L6 update: a single transient HALF_OPEN failure no longer immediately
  // re-opens the circuit; the breaker tolerates one blip before forcing
  // another full cooldown. Two consecutive HALF_OPEN failures DO reopen.
  it("tolerates a single transient HALF_OPEN failure (L6)", async () => {
    const err = new Error("boom");

    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_500);

    await expect(
      withCircuitBreaker(PROVIDER, () => Promise.reject(new Error("still bad"))),
    ).rejects.toThrow("still bad");

    // Single failure → still HALF_OPEN; we do not pay another full cooldown
    // for a one-off network blip.
    expect(getState(PROVIDER)).toBe(CircuitState.HALF_OPEN);
  });

  it("reopens after consecutive HALF_OPEN failures (L6)", async () => {
    const err = new Error("boom");

    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_500);

    // Two consecutive HALF_OPEN failures reopen the circuit.
    for (let i = 0; i < 2; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(new Error("still bad"))),
      ).rejects.toThrow("still bad");
    }

    vi.restoreAllMocks();

    expect(getState(PROVIDER)).toBe(CircuitState.OPEN);
  });

  it("resets failure count on a success before threshold", async () => {
    const err = new Error("boom");

    // Two failures, then a success.
    await expect(
      withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
    ).rejects.toThrow();
    await expect(
      withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
    ).rejects.toThrow();
    await withCircuitBreaker(PROVIDER, async () => "ok");

    // Two more failures — should still be closed (count was reset).
    await expect(
      withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
    ).rejects.toThrow();
    await expect(
      withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
    ).rejects.toThrow();

    expect(getState(PROVIDER)).toBe(CircuitState.CLOSED);
  });

  it("error message includes retry countdown", async () => {
    const err = new Error("boom");

    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(PROVIDER, () => Promise.reject(err)),
      ).rejects.toThrow("boom");
    }

    try {
      await withCircuitBreaker(PROVIDER, async () => "nope");
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpenError);
      expect((e as CircuitOpenError).message).toMatch(/Retrying in \d+s/);
    }
  });
});
