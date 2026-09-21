export type AdmissionLease = () => void

/**
 * Process-local admission gate for graceful shutdown. Once draining begins,
 * no new lease can be acquired; existing work retains its lease until its
 * complete response path has settled.
 */
export class AdmissionGate {
  private accepting = true
  private active = 0
  private readonly idleWaiters = new Set<() => void>()

  tryEnter(): AdmissionLease | null {
    if (!this.accepting) return null
    this.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active = Math.max(0, this.active - 1)
      if (this.active !== 0) return
      for (const resolve of this.idleWaiters) resolve()
      this.idleWaiters.clear()
    }
  }

  beginDrain(): void {
    this.accepting = false
  }

  isDraining(): boolean {
    return !this.accepting
  }

  activeCount(): number {
    return this.active
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    if (this.active === 0) return
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.idleWaiters.delete(onIdle)
        if (error) reject(error)
        else resolve()
      }
      const onIdle = () => finish()
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `${this.active} admitted request(s) did not settle before shutdown.`
            )
          ),
        Math.max(0, timeoutMs)
      )
      timer.unref?.()
      this.idleWaiters.add(onIdle)
      if (this.active === 0) onIdle()
    })
  }
}
