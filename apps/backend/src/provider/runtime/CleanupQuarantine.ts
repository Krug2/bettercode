/**
 * Retention bound for a runtime or server whose close() keeps failing.
 *
 * Adapters quarantine such a handle so a later startSession/stopAll can retry
 * the close instead of forgetting a live process. The window bounds how long
 * an entry may sit *between* retries before it is looked at again with
 * urgency: once it expires the next cleanup pass re-attempts the close and
 * only a confirmed close releases the entry. An entry that still will not
 * close stays quarantined — with a fresh window and a log line — because
 * releasing it would forget a process nobody confirmed gone. That is fail
 * closed on purpose: new sessions on that adapter stay blocked until the
 * process is actually dead. There is no background reaper — the retry
 * happens on the adapter's next startSession/stopSession/stopAll, so a
 * quarantined handle can sit untouched until the user acts again.
 */
export const CLEANUP_QUARANTINE_RETRY_WINDOW_MS = 60_000

export interface CleanupQuarantineState {
  closePromise: Promise<void> | null
  closeFailure: unknown
  /** Wall clock of the first failed close in the current window; null until one fails. */
  firstFailedAt: number | null
  attempts: number
}

export function newCleanupQuarantineState(): CleanupQuarantineState {
  return { closePromise: null, closeFailure: null, firstFailedAt: null, attempts: 0 }
}

export function recordCleanupQuarantineFailure(
  state: CleanupQuarantineState,
  error: unknown,
  now = Date.now()
): void {
  state.closeFailure = error
  state.attempts += 1
  if (state.firstFailedAt === null) state.firstFailedAt = now
}

/** True once retries have been failing for longer than the retry window. */
export function cleanupQuarantineExpired(
  state: CleanupQuarantineState,
  now = Date.now(),
  windowMs = CLEANUP_QUARANTINE_RETRY_WINDOW_MS
): boolean {
  return state.firstFailedAt !== null && now - state.firstFailedAt >= windowMs
}

/** Starts a new retry window after an expired entry failed its re-attempt. */
export function extendCleanupQuarantineWindow(
  state: CleanupQuarantineState,
  now = Date.now()
): void {
  state.firstFailedAt = now
}

export interface CleanupQuarantineLogger {
  error(bindings: Record<string, unknown>, message: string): void
}

/**
 * One cleanup pass over quarantined entries: every entry gets its close
 * re-attempted (`close` is expected to release the entry itself on success,
 * as the adapters' tracked close does). An entry whose window had expired and
 * which fails again is kept, its window restarted and the fact logged; it is
 * never released on a timer. Returns the failures so the caller can refuse
 * new sessions while any handle is unconfirmed.
 */
export async function retryCleanupQuarantines<T extends CleanupQuarantineState>(input: {
  readonly contexts: ReadonlyArray<T>
  readonly close: (context: T) => Promise<void>
  readonly label: string
  readonly logger: CleanupQuarantineLogger
  readonly now?: number
  readonly windowMs?: number
}): Promise<unknown[]> {
  const now = input.now ?? Date.now()
  const windowMs = input.windowMs ?? CLEANUP_QUARANTINE_RETRY_WINDOW_MS
  const results = await Promise.allSettled(
    input.contexts.map(async (context) => {
      const expired =
        !context.closePromise && cleanupQuarantineExpired(context, now, windowMs)
      try {
        await input.close(context)
      } catch (error) {
        if (expired) {
          extendCleanupQuarantineWindow(context, Date.now())
          input.logger.error(
            {
              err: error,
              attempts: context.attempts,
              windowMs,
            },
            `quarantined ${input.label} still would not close after the retry window; keeping it quarantined until its process is confirmed gone`
          )
        }
        throw error
      }
    })
  )
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  )
}
