import type { Writable } from "node:stream"

export interface ChildStdinWriterLogger {
  warn(bindings: Record<string, unknown>, message: string): void
}

/**
 * Upper bound on payload bytes held behind `drain`. A child that stops
 * reading its stdin (wedged, or mid-crash) must not turn every later write
 * into unbounded backend memory; past this the write is refused instead.
 */
export const DEFAULT_CHILD_STDIN_QUEUE_MAX_BYTES = 4 * 1024 * 1024

/**
 * Serialises writes to a provider child's stdin.
 *
 * Two things a bare `child.stdin.write()` gets wrong for a long-lived RPC
 * peer: an `error` event on the pipe (EPIPE when the child dies mid-write)
 * crashes the backend if nobody listens, and a `false` return means the
 * kernel buffer is full — keep writing and the payloads pile up in memory
 * until the child reads again. This wrapper listens for the error, marks
 * itself dead so later writes are dropped with one log line instead of a
 * throw, holds writes behind `drain` when the stream asks for it, and bounds
 * how much it will hold.
 */
export class ChildStdinWriter {
  private readonly queue: string[] = []
  private queuedBytes = 0
  private waitingForDrain = false
  private dead = false
  private deadReason: string | null = null
  private readonly queueMaxBytes: number

  constructor(
    private readonly stdin: Writable,
    private readonly options: {
      readonly label: string
      readonly logger: ChildStdinWriterLogger
      readonly onError?: (error: Error) => void
      readonly queueMaxBytes?: number
    }
  ) {
    this.queueMaxBytes =
      typeof options.queueMaxBytes === "number" && options.queueMaxBytes > 0
        ? options.queueMaxBytes
        : DEFAULT_CHILD_STDIN_QUEUE_MAX_BYTES
    // Test seams sometimes hand in a bare `{ write }`; a real stdin is an
    // EventEmitter and gets the listener that keeps EPIPE from crashing us.
    if (typeof stdin.on === "function") {
      stdin.on("error", (error: Error) => {
        // Count before markDead empties the queue, or the log always says 0.
        const dropped = this.queue.length
        const droppedBytes = this.queuedBytes
        this.markDead(`stdin error: ${error.message}`, { silent: true })
        this.options.logger.warn(
          {
            err: error,
            label: this.options.label,
            dropped,
            droppedBytes,
          },
          `${this.options.label} stdin errored; later writes are dropped`
        )
        this.options.onError?.(error)
      })
    }
  }

  get isDead(): boolean {
    return this.dead
  }

  /** Bytes currently held behind `drain`. */
  get pendingBytes(): number {
    return this.queuedBytes
  }

  /**
   * Marks the peer as gone; later writes are no-ops with a log line. Writes
   * still queued behind `drain` are dropped and, unless the caller logs them
   * itself, reported once here (an exit with a non-empty queue is data the
   * child never saw).
   */
  markDead(reason: string, options: { readonly silent?: boolean } = {}): void {
    if (this.dead) return
    this.dead = true
    this.deadReason = reason
    const dropped = this.queue.length
    const droppedBytes = this.queuedBytes
    this.queue.length = 0
    this.queuedBytes = 0
    if (dropped > 0 && !options.silent) {
      this.options.logger.warn(
        { label: this.options.label, reason, dropped, droppedBytes },
        `${this.options.label} queued writes dropped; child is gone`
      )
    }
  }

  /**
   * Queues or writes `payload`. Returns false when the payload was not
   * accepted — the peer is dead, or holding it would exceed the queue bound;
   * callers that need a failure signal (a pending RPC call) should reject on
   * false, fire-and-forget callers can ignore it.
   */
  write(payload: string): boolean {
    if (this.dead) {
      this.options.logger.warn(
        {
          label: this.options.label,
          reason: this.deadReason,
          bytes: Buffer.byteLength(payload, "utf8"),
        },
        `${this.options.label} write dropped; child is gone`
      )
      return false
    }
    if (this.waitingForDrain) {
      const bytes = Buffer.byteLength(payload, "utf8")
      if (this.queuedBytes + bytes > this.queueMaxBytes) {
        this.options.logger.warn(
          {
            label: this.options.label,
            bytes,
            queuedBytes: this.queuedBytes,
            queueMaxBytes: this.queueMaxBytes,
          },
          `${this.options.label} write refused; stdin backlog exceeded its byte bound`
        )
        return false
      }
      this.queue.push(payload)
      this.queuedBytes += bytes
      return true
    }
    return this.writeNow(payload)
  }

  private writeNow(payload: string): boolean {
    let accepted: boolean
    try {
      accepted = this.stdin.write(payload)
    } catch (error) {
      // Writing to a destroyed stream throws synchronously on some Node
      // versions and emits `error` on others; treat both as the child gone.
      this.markDead(
        `stdin write threw: ${error instanceof Error ? error.message : String(error)}`
      )
      this.options.logger.warn(
        { err: error, label: this.options.label },
        `${this.options.label} stdin write failed; later writes are dropped`
      )
      return false
    }
    if (!accepted && typeof this.stdin.once === "function") {
      this.waitingForDrain = true
      this.stdin.once("drain", () => this.flush())
    }
    return true
  }

  private flush(): void {
    this.waitingForDrain = false
    while (this.queue.length > 0 && !this.dead && !this.waitingForDrain) {
      const next = this.queue.shift()
      if (next === undefined) break
      this.queuedBytes = Math.max(
        0,
        this.queuedBytes - Buffer.byteLength(next, "utf8")
      )
      this.writeNow(next)
    }
  }
}
