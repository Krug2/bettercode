/**
 * Unified error hierarchy for frontend error handling.
 *
 * All app-originated errors extend `AppError`. Every error that flows to
 * `handleError()` gets normalised into one of these (unknown errors become
 * the `AppError` base). Keeping the inheritance chain means legacy code that
 * just reads `err.message` continues to work while new code can match on
 * `instanceof HttpError` / `IpcError` / `ValidationError`.
 */

export class AppError extends Error {
  readonly cause?: unknown
  readonly code?: string

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message)
    this.name = new.target.name
    this.cause = options?.cause
    this.code = options?.code
  }
}

export class HttpError extends AppError {
  readonly status: number
  readonly path: string

  constructor(
    message: string,
    status: number,
    path: string,
    options?: { cause?: unknown; code?: string },
  ) {
    super(message, options)
    this.status = status
    this.path = path
  }
}

export class IpcError extends AppError {
  readonly channel: string

  constructor(message: string, channel: string, options?: { cause?: unknown; code?: string }) {
    super(message, options)
    this.channel = channel
  }
}

export class ValidationError extends AppError {
  readonly issues: unknown

  constructor(message: string, issues: unknown, options?: { cause?: unknown; code?: string }) {
    super(message, options)
    this.issues = issues
  }
}

export class TimeoutError extends AppError {
  readonly timeoutMs: number

  constructor(message: string, timeoutMs: number, options?: { cause?: unknown; code?: string }) {
    super(message, options)
    this.timeoutMs = timeoutMs
  }
}
