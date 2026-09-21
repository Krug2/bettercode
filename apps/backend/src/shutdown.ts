import type http from "node:http"

export interface ShutdownStep {
  name: string
  run: () => void | Promise<void>
}

export interface ShutdownFailure {
  name: string
  cause: unknown
}

export class ShutdownTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Backend shutdown did not complete within ${timeoutMs}ms`)
    this.name = "ShutdownTimeoutError"
  }
}

/**
 * Bound a shutdown transaction without terminating the embedding process.
 *
 * The underlying cleanup remains observed if the deadline wins, so a late
 * rejection cannot become unhandled. Standalone hosts may decide to exit;
 * embedded hosts (for example Electron) receive a normal rejected promise.
 */
export async function runWithShutdownDeadline(
  operation: () => Promise<void>,
  timeoutMs: number,
  onTimeout?: (error: ShutdownTimeoutError) => void
): Promise<void> {
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ShutdownTimeoutError(boundedTimeoutMs)
      try {
        onTimeout?.(error)
      } catch {
        // Reporting must never replace the actual timeout or escape the timer
        // callback as an uncaught exception.
      }
      reject(error)
    }, boundedTimeoutMs)
  })
  const work = Promise.resolve().then(operation)

  try {
    await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Run every cleanup step before reporting any failures. */
export async function runShutdownSteps(
  steps: readonly ShutdownStep[],
  onFailure?: (failure: ShutdownFailure) => void
): Promise<void> {
  const failures: ShutdownFailure[] = []

  for (const step of steps) {
    try {
      await step.run()
    } catch (cause) {
      const failure = { name: step.name, cause }
      failures.push(failure)
      try {
        onFailure?.(failure)
      } catch (reportingCause) {
        failures.push({
          name: `${step.name} failure reporter`,
          cause: reportingCause,
        })
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ cause }) => cause),
      `Backend shutdown failed in: ${failures.map(({ name }) => name).join(", ")}`
    )
  }
}

/**
 * Stop accepting new HTTP connections, drain existing requests for a bounded
 * period, then force-close remaining sockets. Resolves only after the server
 * close callback fires; a forced drain is reported as a cleanup failure.
 */
export async function closeHttpServer(
  server: http.Server,
  timeoutMs: number
): Promise<void> {
  if (!server.listening) return

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let forcedDrainError: Error | null = null
    const finish = (error?: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else if (forcedDrainError) reject(forcedDrainError)
      else resolve()
    }
    const timer = setTimeout(() => {
      server.closeAllConnections?.()
      forcedDrainError = new Error(
        `HTTP connections did not drain within ${timeoutMs}ms and were force-closed`
      )
      // Do not settle until server.close's callback confirms that no handler
      // can continue into later provider/database cleanup. The process-level
      // hard shutdown timer remains the ultimate bound if Node never calls it.
    }, Math.max(1, timeoutMs))

    server.close((error) => finish(error))
    server.closeIdleConnections?.()
  })
}
