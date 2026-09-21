import { createLogger } from "@/lib/logger"
import { AppError } from "./types"

const log = createLogger("errors")

export interface HandleErrorContext {
  source: string
  silent?: boolean
}

/**
 * Normalise any thrown value into an `AppError`, log it with structured
 * context, and optionally surface it via toast. Callers MUST pass a `source`
 * string so logs carry attribution; use e.g. `"chat-submit"`, `"git-panel"`.
 */
export function handleError(err: unknown, ctx: HandleErrorContext): AppError {
  const normalized = toAppError(err)
  log.error(ctx.source, {
    name: normalized.name,
    message: normalized.message,
    code: normalized.code,
    cause: normalized.cause,
  })
  if (!ctx.silent) {
    surfaceToast(normalized, ctx.source)
  }
  return normalized
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof Error) {
    const wrapped = new AppError(err.message, { cause: err })
    wrapped.name = err.name || "Error"
    return wrapped
  }
  if (typeof err === "string") return new AppError(err)
  return new AppError("Unknown error", { cause: err })
}

function surfaceToast(err: AppError, source: string) {
  const scope = globalThis as unknown as { __BETTERC0DE_TOAST__?: (msg: string, source: string) => void }
  const bus = scope.__BETTERC0DE_TOAST__
  if (typeof bus === "function") {
    bus(err.message, source)
  }
}
