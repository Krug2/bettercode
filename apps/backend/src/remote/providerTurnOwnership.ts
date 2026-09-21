export interface RemoteProviderTurnReservation {
  readonly sessionId: string
  readonly generation: string
  readonly token: symbol
}

export interface RemoteOwnedProviderTurn {
  readonly turnId: string
  readonly settled: Promise<void>
  /** Must target this exact turn identity, never merely the same thread. */
  readonly interrupt: () => Promise<unknown>
}

interface RemoteProviderTurnEntry {
  readonly reservation: RemoteProviderTurnReservation
  revoked: boolean
  turn: RemoteOwnedProviderTurn | null
  cleanup: Promise<void> | null
}

export class RemoteProviderOwnerInactiveError extends Error {
  readonly statusCode = 403
  readonly code = "remote_session_inactive"

  constructor(readonly sessionId: string) {
    super("Remote session is no longer active.")
    this.name = "RemoteProviderOwnerInactiveError"
  }
}

/**
 * Bridges revocable remote authentication to provider-turn lifetime.
 *
 * A reservation is recorded before any asynchronous dispatch preparation.
 * Revocation can therefore close the race before `startTurn`; once a handle
 * is attached, cleanup interrupts that exact turn id and retains the owner
 * entry until its terminal settlement promise completes.
 */
export class RemoteProviderTurnOwnership {
  private readonly entriesBySession = new Map<
    string,
    Map<symbol, RemoteProviderTurnEntry>
  >()
  private acceptingReservations = true
  private readonly settlementTimeoutMs: number

  constructor(
    private readonly isSessionActive: (sessionId: string) => boolean,
    options: { readonly settlementTimeoutMs?: number } = {}
  ) {
    this.settlementTimeoutMs = Math.max(
      1,
      Math.min(60_000, Math.floor(options.settlementTimeoutMs ?? 5_000))
    )
  }

  reserve(input: {
    readonly sessionId: string
    readonly generation: string
    readonly expiresAt: string
  }): RemoteProviderTurnReservation {
    if (
      !this.acceptingReservations ||
      !input.sessionId ||
      !input.generation ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.now() ||
      !this.safeIsSessionActive(input.sessionId)
    ) {
      throw new RemoteProviderOwnerInactiveError(input.sessionId)
    }

    const reservation: RemoteProviderTurnReservation = {
      sessionId: input.sessionId,
      generation: input.generation,
      token: Symbol(`remote-provider:${input.sessionId}:${input.generation}`),
    }
    let entries = this.entriesBySession.get(input.sessionId)
    if (!entries) {
      entries = new Map()
      this.entriesBySession.set(input.sessionId, entries)
    }
    entries.set(reservation.token, {
      reservation,
      revoked: false,
      turn: null,
      cleanup: null,
    })
    return reservation
  }

  assertActive(reservation: RemoteProviderTurnReservation): void {
    const entry = this.findEntry(reservation)
    if (
      !entry ||
      entry.revoked ||
      !this.acceptingReservations ||
      !this.safeIsSessionActive(reservation.sessionId)
    ) {
      throw new RemoteProviderOwnerInactiveError(reservation.sessionId)
    }
  }

  /**
   * Attaches synchronously before returning its promise, so an explicit
   * revoke cannot interleave between provider admission and ownership.
   */
  attach(
    reservation: RemoteProviderTurnReservation,
    turn: RemoteOwnedProviderTurn
  ): Promise<void> {
    let entry = this.findEntry(reservation)
    if (
      !entry ||
      entry.revoked ||
      !this.acceptingReservations ||
      !this.safeIsSessionActive(reservation.sessionId)
    ) {
      // Revocation may remove a still-preparing reservation immediately
      // before provider admission returns. Re-establish a quarantined owner
      // record before interrupting so a failed hard stop remains visible to
      // shutdown/survivor audits instead of becoming an untracked child.
      if (!entry) {
        entry = {
          reservation,
          revoked: true,
          turn,
          cleanup: null,
        }
        let entries = this.entriesBySession.get(reservation.sessionId)
        if (!entries) {
          entries = new Map()
          this.entriesBySession.set(reservation.sessionId, entries)
        }
        entries.set(reservation.token, entry)
      } else {
        entry.revoked = true
        entry.turn = turn
      }
      this.watchSettlement(entry, turn)
      return this.cleanupAttachedEntry(entry).then(
        () => {
          throw new RemoteProviderOwnerInactiveError(reservation.sessionId)
        },
        (error) => {
          throw new AggregateError(
            [new RemoteProviderOwnerInactiveError(reservation.sessionId), error],
            "Remote provider turn was admitted after its owner became inactive"
          )
        }
      )
    }

    entry.turn = turn
    this.watchSettlement(entry, turn)
    return Promise.resolve()
  }

  cancel(reservation: RemoteProviderTurnReservation): void {
    const entry = this.findEntry(reservation)
    if (!entry || entry.turn) return
    this.removeEntry(entry)
  }

  async revokeSession(sessionId: string): Promise<number> {
    const entries = [
      ...(this.entriesBySession.get(sessionId)?.values() ?? []),
    ]
    if (entries.length === 0) return 0

    const cleanups: Promise<void>[] = []
    for (const entry of entries) {
      entry.revoked = true
      if (!entry.turn) {
        this.removeEntry(entry)
        continue
      }
      cleanups.push(this.cleanupAttachedEntry(entry))
    }
    const results = await Promise.allSettled(cleanups)
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    )
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to settle ${failures.length} provider turn(s) for revoked remote session '${sessionId}'.`
      )
    }
    return entries.length
  }

  async shutdown(): Promise<number> {
    this.acceptingReservations = false
    const sessionIds = [...this.entriesBySession.keys()]
    const results = await Promise.allSettled(
      sessionIds.map((sessionId) => this.revokeSession(sessionId))
    )
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    )
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Remote provider turn ownership did not settle during shutdown"
      )
    }
    return results.reduce(
      (total, result) =>
        total + (result.status === "fulfilled" ? result.value : 0),
      0
    )
  }

  activeCount(sessionId?: string): number {
    if (sessionId) return this.entriesBySession.get(sessionId)?.size ?? 0
    let count = 0
    for (const entries of this.entriesBySession.values()) count += entries.size
    return count
  }

  private cleanupAttachedEntry(entry: RemoteProviderTurnEntry): Promise<void> {
    if (entry.cleanup) return entry.cleanup
    const turn = entry.turn
    if (!turn) return Promise.resolve()
    const cleanup = this.interruptAndSettleDetached(turn).then(
      () => {
        this.removeEntry(entry)
      },
      (error) => {
        // Keep the revoked entry quarantined. A later revoke/shutdown can
        // retry, and the settlement watcher removes it if the turn eventually
        // reaches a terminal state after this bounded caller has returned.
        if (entry.cleanup === cleanup) entry.cleanup = null
        throw error
      }
    )
    entry.cleanup = cleanup
    return entry.cleanup
  }

  private async interruptAndSettleDetached(
    turn: RemoteOwnedProviderTurn
  ): Promise<void> {
    let interruptFailure: unknown = null
    void Promise.resolve()
      .then(() => turn.interrupt())
      .catch((error) => {
        interruptFailure = error
      })
    try {
      await withDeadline(
        turn.settled,
        this.settlementTimeoutMs,
        `Remote-owned provider turn '${turn.turnId}' did not settle within ${this.settlementTimeoutMs}ms.`
      )
    } catch (settlementFailure) {
      throw new AggregateError(
        interruptFailure === null
          ? [settlementFailure]
          : [interruptFailure, settlementFailure],
        `Remote-owned provider turn '${turn.turnId}' did not interrupt and settle cleanly.`
      )
    }
  }

  private watchSettlement(
    entry: RemoteProviderTurnEntry,
    turn: RemoteOwnedProviderTurn
  ): void {
    void turn.settled.then(
      () => this.removeEntry(entry),
      () => {
        // A rejected settlement means the provider could not prove its
        // terminal hooks/process cleanup. Keep the revoked owner quarantined
        // so shutdown reports the survivor instead of silently forgetting it.
      }
    )
  }

  private findEntry(
    reservation: RemoteProviderTurnReservation
  ): RemoteProviderTurnEntry | null {
    const entry = this.entriesBySession
      .get(reservation.sessionId)
      ?.get(reservation.token)
    if (
      !entry ||
      entry.reservation.generation !== reservation.generation
    ) {
      return null
    }
    return entry
  }

  private removeEntry(entry: RemoteProviderTurnEntry): void {
    const entries = this.entriesBySession.get(entry.reservation.sessionId)
    if (entries?.get(entry.reservation.token) !== entry) return
    entries.delete(entry.reservation.token)
    if (entries.size === 0) {
      this.entriesBySession.delete(entry.reservation.sessionId)
    }
  }

  private safeIsSessionActive(sessionId: string): boolean {
    try {
      return this.isSessionActive(sessionId) === true
    } catch {
      return false
    }
  }
}

function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      timer.unref?.()
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
