import { describe, expect, it, vi } from "vitest"
import {
  RemoteProviderOwnerInactiveError,
  RemoteProviderTurnOwnership,
} from "./providerTurnOwnership"

function reservationInput(sessionId: string) {
  return {
    sessionId,
    generation: `created:${sessionId}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
}

describe("RemoteProviderTurnOwnership", () => {
  it("interrupts only the revoked owner's exact turn and waits for settlement", async () => {
    const ownership = new RemoteProviderTurnOwnership(() => true)
    const first = ownership.reserve(reservationInput("session-a"))
    const second = ownership.reserve(reservationInput("session-b"))
    let settleFirst!: () => void
    const firstSettled = new Promise<void>((resolve) => {
      settleFirst = resolve
    })
    const interruptFirst = vi.fn(async () => true)
    const interruptSecond = vi.fn(async () => true)
    await ownership.attach(first, {
      turnId: "turn-a",
      settled: firstSettled,
      interrupt: interruptFirst,
    })
    await ownership.attach(second, {
      turnId: "turn-b",
      settled: new Promise<void>(() => {}),
      interrupt: interruptSecond,
    })

    let revoked = false
    const revocation = ownership.revokeSession("session-a").then((count) => {
      revoked = true
      return count
    })
    await vi.waitFor(() => expect(interruptFirst).toHaveBeenCalledOnce())
    expect(interruptSecond).not.toHaveBeenCalled()
    expect(revoked).toBe(false)

    settleFirst()
    await expect(revocation).resolves.toBe(1)
    expect(ownership.activeCount("session-a")).toBe(0)
    expect(ownership.activeCount("session-b")).toBe(1)
  })

  it("closes a pre-dispatch reservation and interrupts a turn attached after revocation", async () => {
    const ownership = new RemoteProviderTurnOwnership(() => true)
    const reservation = ownership.reserve(reservationInput("session-race"))

    await expect(
      ownership.revokeSession("session-race")
    ).resolves.toBe(1)
    expect(() => ownership.assertActive(reservation)).toThrow(
      RemoteProviderOwnerInactiveError
    )

    const interrupt = vi.fn(async () => true)
    await expect(
      ownership.attach(reservation, {
        turnId: "turn-after-revoke",
        settled: Promise.resolve(),
        interrupt,
      })
    ).rejects.toBeInstanceOf(RemoteProviderOwnerInactiveError)
    expect(interrupt).toHaveBeenCalledOnce()
  })

  it("rejects stale owner generations and inactive sessions before admission", () => {
    let active = true
    const ownership = new RemoteProviderTurnOwnership(() => active)
    const reservation = ownership.reserve(reservationInput("session-a"))

    expect(() =>
      ownership.assertActive({
        ...reservation,
        generation: "different-generation",
      })
    ).toThrow(RemoteProviderOwnerInactiveError)

    active = false
    expect(() => ownership.assertActive(reservation)).toThrow(
      RemoteProviderOwnerInactiveError
    )
    expect(() =>
      ownership.reserve(reservationInput("session-b"))
    ).toThrow(RemoteProviderOwnerInactiveError)
  })

  it("bounds revocation waits and retains an unconfirmed turn for survivor audits", async () => {
    vi.useFakeTimers()
    try {
      const ownership = new RemoteProviderTurnOwnership(
        () => true,
        { settlementTimeoutMs: 100 }
      )
      const reservation = ownership.reserve(
        reservationInput("session-survivor")
      )
      let settle!: () => void
      const settled = new Promise<void>((resolve) => {
        settle = resolve
      })
      const interrupt = vi.fn(async () => true)
      await ownership.attach(reservation, {
        turnId: "turn-survivor",
        settled,
        interrupt,
      })

      const revocation = ownership
        .revokeSession("session-survivor")
        .then(
          (value) => ({ value, error: null as unknown }),
          (error) => ({ value: null, error })
        )
      await vi.advanceTimersByTimeAsync(101)
      const outcome = await revocation
      expect(outcome.error).toBeInstanceOf(AggregateError)
      expect((outcome.error as Error).message).toMatch(/Failed to settle/)
      expect(interrupt).toHaveBeenCalledOnce()
      expect(ownership.activeCount("session-survivor")).toBe(1)

      settle()
      await vi.runAllTicks()
      expect(ownership.activeCount("session-survivor")).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
