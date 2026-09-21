interface ActiveTurnReservation {
  readonly token: symbol
  readonly owner: string
}

export class ThreadTurnCoordinator {
  private readonly activeTurns = new Map<string, ActiveTurnReservation>()
  private readonly maintenance = new Set<string>()
  private readonly idleWaiters = new Map<string, Set<() => void>>()

  /** Includes pre-dispatch compaction and maintenance, before a Hub turn exists. */
  waitForIdle(threadId: string): Promise<void> {
    if (!this.maintenance.has(threadId) && !this.activeTurns.has(threadId)) return Promise.resolve()
    return new Promise(resolve => {
      const waiters = this.idleWaiters.get(threadId) ?? new Set<() => void>()
      waiters.add(resolve)
      this.idleWaiters.set(threadId, waiters)
    })
  }

  private notifyIdle(threadId: string): void {
    if (this.maintenance.has(threadId) || this.activeTurns.has(threadId)) return
    const waiters = this.idleWaiters.get(threadId)
    this.idleWaiters.delete(threadId)
    for (const resolve of waiters ?? []) resolve()
  }

  reserveTurn(threadId: string, owner: string): symbol | null {
    if (this.maintenance.has(threadId) || this.activeTurns.has(threadId)) {
      return null
    }
    const token = Symbol(`${threadId}:${owner}`)
    this.activeTurns.set(threadId, { token, owner })
    return token
  }

  releaseTurn(threadId: string, token: symbol): void {
    if (this.activeTurns.get(threadId)?.token === token) {
      this.activeTurns.delete(threadId)
      this.notifyIdle(threadId)
    }
  }

  activeOwner(threadId: string): string | null {
    return this.activeTurns.get(threadId)?.owner ?? null
  }

  async withMaintenance<T>(
    threadId: string,
    operation: () => Promise<T> | T
  ): Promise<T> {
    if (this.maintenance.has(threadId) || this.activeTurns.has(threadId)) {
      throw threadTurnConflict(threadId, this.activeOwner(threadId))
    }
    this.maintenance.add(threadId)
    try {
      return await operation()
    } finally {
      this.maintenance.delete(threadId)
      this.notifyIdle(threadId)
    }
  }

  async withTeardown<T>(
    threadId: string,
    operation: () => Promise<T> | T
  ): Promise<T> {
    if (this.maintenance.has(threadId)) {
      throw threadTurnConflict(threadId, "maintenance")
    }
    this.maintenance.add(threadId)
    try {
      return await operation()
    } finally {
      this.maintenance.delete(threadId)
      this.notifyIdle(threadId)
    }
  }
}

function threadTurnConflict(threadId: string, owner: string | null): Error {
  return Object.assign(
    new Error(`Thread '${threadId}' already has active provider work.`),
    {
      statusCode: 409,
      code: "turn_active",
      activeTurnId: owner ?? `maintenance:${threadId}`,
    }
  )
}
