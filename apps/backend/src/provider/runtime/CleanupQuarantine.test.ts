import { describe, expect, it, vi } from "vitest"
import {
  CLEANUP_QUARANTINE_RETRY_WINDOW_MS,
  cleanupQuarantineExpired,
  extendCleanupQuarantineWindow,
  newCleanupQuarantineState,
  recordCleanupQuarantineFailure,
  retryCleanupQuarantines,
} from "./CleanupQuarantine"

describe("CleanupQuarantine", () => {
  it("counts failures from the first one and expires only after the window", () => {
    const state = newCleanupQuarantineState()
    expect(cleanupQuarantineExpired(state, 10_000)).toBe(false)

    recordCleanupQuarantineFailure(state, new Error("a"), 1_000)
    recordCleanupQuarantineFailure(state, new Error("b"), 2_000)
    expect(state).toMatchObject({ attempts: 2, firstFailedAt: 1_000 })
    expect((state.closeFailure as Error).message).toBe("b")
    expect(
      cleanupQuarantineExpired(state, 1_000 + CLEANUP_QUARANTINE_RETRY_WINDOW_MS - 1)
    ).toBe(false)
    expect(
      cleanupQuarantineExpired(state, 1_000 + CLEANUP_QUARANTINE_RETRY_WINDOW_MS)
    ).toBe(true)

    extendCleanupQuarantineWindow(state, 500_000)
    expect(cleanupQuarantineExpired(state, 500_000 + 1)).toBe(false)
  })

  it("keeps an expired entry quarantined when its re-attempt fails, with a fresh window and a log line", async () => {
    const expired = { ...newCleanupQuarantineState(), name: "expired" }
    recordCleanupQuarantineFailure(expired, new Error("first"), 0)
    const fresh = { ...newCleanupQuarantineState(), name: "fresh" }
    recordCleanupQuarantineFailure(fresh, new Error("first"), 90_000)
    const logger = { error: vi.fn() }
    const stillStuck = new Error("still stuck")
    const close = vi.fn(async (context: { name: string }) => {
      if (context.name === "expired") {
        recordCleanupQuarantineFailure(expired, stillStuck, 100_000)
        throw stillStuck
      }
    })

    const failures = await retryCleanupQuarantines({
      contexts: [expired, fresh],
      close,
      label: "test runtime",
      logger,
      now: 100_000,
    })

    // Both entries were re-attempted; the failure is reported to the caller
    // so new sessions stay blocked — the entry is never released on a timer.
    expect(close).toHaveBeenCalledTimes(2)
    expect(failures).toEqual([stillStuck])
    expect(expired.firstFailedAt).toBeGreaterThanOrEqual(100_000)
    expect(cleanupQuarantineExpired(expired, 100_000 + 1)).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: stillStuck, attempts: 2 }),
      "quarantined test runtime still would not close after the retry window; keeping it quarantined until its process is confirmed gone"
    )
  })

  it("does not restart the window or log for a non-expired entry that fails again", async () => {
    const entry = newCleanupQuarantineState()
    recordCleanupQuarantineFailure(entry, new Error("first"), 90_000)
    const logger = { error: vi.fn() }
    const failure = new Error("again")

    const failures = await retryCleanupQuarantines({
      contexts: [entry],
      close: async () => {
        throw failure
      },
      label: "test runtime",
      logger,
      now: 95_000,
    })

    expect(failures).toEqual([failure])
    expect(entry.firstFailedAt).toBe(90_000)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("releases an entry only through a confirmed close, and keeps one whose close still fails", async () => {
    // The adapters' tracked close deletes its own quarantine entry on
    // success; the pass itself never releases anything. Model that registry
    // and check which entries survive it.
    const confirmed = { ...newCleanupQuarantineState(), name: "confirmed" }
    recordCleanupQuarantineFailure(confirmed, new Error("first"), 0)
    const stuck = { ...newCleanupQuarantineState(), name: "stuck" }
    recordCleanupQuarantineFailure(stuck, new Error("first"), 0)
    const quarantine = new Set([confirmed, stuck])
    const logger = { error: vi.fn() }
    const stillStuck = new Error("still stuck")

    const failures = await retryCleanupQuarantines({
      contexts: [...quarantine],
      close: async (context) => {
        if (context.name === "stuck") {
          recordCleanupQuarantineFailure(context, stillStuck)
          throw stillStuck
        }
        quarantine.delete(context)
      },
      label: "test runtime",
      logger,
      now: CLEANUP_QUARANTINE_RETRY_WINDOW_MS + 1,
    })

    expect(failures).toEqual([stillStuck])
    expect(quarantine.has(confirmed)).toBe(false)
    expect(quarantine.has(stuck)).toBe(true)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: stillStuck }),
      expect.stringContaining("keeping it quarantined")
    )
  })
})
