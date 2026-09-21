import { logToErrorStore } from "@/lib/error-log-store"

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// In production builds the min level could be bumped via env var in a future
// milestone. For now, log everything in dev, info+ in prod.
const MIN_LEVEL: LogLevel =
  typeof import.meta !== "undefined" && import.meta.env?.MODE === "production"
    ? "info"
    : "debug"

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function formatPrefix(module: string, level: LogLevel): string {
  return `[${new Date().toISOString()}] [${level}] [${module}]`
}

function emit(module: string, level: LogLevel, args: unknown[]) {
  if (!shouldLog(level)) return
  const prefix = formatPrefix(module, level)
  const nativeFn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "info"
          ? console.info
          : console.debug
  nativeFn(prefix, ...args)

  if (level === "warn" || level === "error") {
    const message = args
      .map((a) =>
        a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)
      )
      .join(" ")
    const stack = args.find((a): a is Error => a instanceof Error)?.stack
    logToErrorStore({
      level: level === "warn" ? "warn" : "error",
      message,
      stack,
      source: module,
    })
  }
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(module: string): Logger {
  return {
    debug: (...args) => emit(module, "debug", args),
    info: (...args) => emit(module, "info", args),
    warn: (...args) => emit(module, "warn", args),
    error: (...args) => emit(module, "error", args),
  }
}
