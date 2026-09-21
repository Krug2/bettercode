import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { logger } from "../../observability/logger"

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_FILES = 10
const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_PENDING_ENTRIES = 2_048
const DEFAULT_MAX_DIRECTORY_BYTES = 256 * 1024 * 1024
const GLOBAL_THREAD_SEGMENT = "_global"
const THREAD_SEGMENT_PREFIX_MAX_CHARS = 80
const THREAD_SEGMENT_HASH_CHARS = 16
const SENSITIVE_FIELD_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passphrase",
  "secret",
  "credential",
  "credentials",
  "privatekey",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
])

const directoryTails = new Map<string, Promise<void>>()

export type EventNdjsonStream = "native" | "canonical" | "orchestration"

export interface EventNdjsonLogger {
  readonly filePath: string
  write(event: unknown, threadId: string | null | undefined): void
  flush(): Promise<void>
  removeThread(threadId: string): Promise<void>
  close(): void
}

export interface EventNdjsonLoggerOptions {
  readonly stream: EventNdjsonStream
  readonly shouldWrite?: () => boolean
  readonly maxBytes?: number
  readonly maxFiles?: number
  readonly maxPendingBytes?: number
  readonly maxPendingEntries?: number
  readonly maxDirectoryBytes?: number
}

interface PendingWrite {
  readonly filePath: string
  readonly line: string
  readonly bytes: number
  readonly threadSegment: string
}

export function providerEventTraceEnabled(settings: {
  readonly backend_trace_provider_events?: boolean
}): boolean {
  return settings.backend_trace_provider_events === true
}

export function makeEventNdjsonLogger(
  filePath: string,
  options: EventNdjsonLoggerOptions
): EventNdjsonLogger | undefined {
  const baseDir = path.dirname(filePath)
  try {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 })
    if (process.platform !== "win32") fs.chmodSync(baseDir, 0o700)
  } catch (err) {
    logger.warn(
      { err, filePath },
      "failed to create provider event log directory"
    )
    return undefined
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES)
  const maxPendingBytes = positiveLimit(
    options.maxPendingBytes,
    DEFAULT_MAX_PENDING_BYTES
  )
  const maxPendingEntries = positiveLimit(
    options.maxPendingEntries,
    DEFAULT_MAX_PENDING_ENTRIES
  )
  const maxDirectoryBytes = positiveLimit(
    options.maxDirectoryBytes,
    DEFAULT_MAX_DIRECTORY_BYTES
  )
  const streamLabel = resolveStreamLabel(options.stream)
  let pending: PendingWrite[] = []
  let pendingBytes = 0
  let drainPromise: Promise<void> | null = null
  let closed = false
  let droppedWrites = 0

  const drain = (): Promise<void> => {
    if (drainPromise) return drainPromise
    drainPromise = (async () => {
      while (pending.length > 0) {
        const next = pending.shift()
        if (!next) break
        pendingBytes = Math.max(0, pendingBytes - next.bytes)
        await withDirectoryLock(baseDir, async () => {
          try {
            await rotateIfNeeded(next.filePath, next.bytes, {
              maxBytes,
              maxFiles,
            })
            await fs.promises.appendFile(next.filePath, next.line, {
              encoding: "utf8",
              mode: 0o600,
            })
            if (process.platform !== "win32") {
              await fs.promises.chmod(next.filePath, 0o600)
            }
          } catch (err) {
            logger.warn(
              { err, filePath: next.filePath },
              "provider event log write failed"
            )
          }
        })
      }
      try {
        await withDirectoryLock(baseDir, () =>
          enforceDirectoryBudget(baseDir, maxDirectoryBytes)
        )
      } catch (err) {
        logger.warn(
          { err, baseDir },
          "provider event log directory cleanup failed"
        )
      }
    })().finally(() => {
      drainPromise = null
      if (pending.length > 0) void drain()
    })
    return drainPromise
  }

  return {
    filePath,
    write(event, threadId) {
      if (closed) return
      try {
        if (options.shouldWrite?.() === false) return
      } catch (err) {
        logger.warn(
          { err, filePath },
          "provider event log policy check failed; suppressing write"
        )
        return
      }
      let payload: string
      try {
        payload = JSON.stringify(event, sensitiveLogReplacer())
      } catch (err) {
        logger.warn({ err }, "failed to serialize provider event log record")
        return
      }
      if (typeof payload !== "string") return

      const threadSegment = resolveThreadSegment(threadId)
      const threadFilePath = path.join(baseDir, `${threadSegment}.log`)
      const line = `[${new Date().toISOString()}] ${streamLabel}: ${payload}\n`
      const bytes = Buffer.byteLength(line, "utf8")
      if (
        bytes > maxPendingBytes ||
        pending.length >= maxPendingEntries ||
        pendingBytes + bytes > maxPendingBytes
      ) {
        droppedWrites += 1
        if (droppedWrites === 1 || droppedWrites % 100 === 0) {
          logger.warn(
            { droppedWrites, maxPendingBytes, maxPendingEntries },
            "provider event log queue full; dropping best-effort record"
          )
        }
        return
      }

      pending.push({
        filePath: threadFilePath,
        line,
        bytes,
        threadSegment,
      })
      pendingBytes += bytes
      void drain()
    },
    async flush() {
      while (drainPromise || pending.length > 0) {
        await (drainPromise ?? drain())
      }
    },
    async removeThread(threadId) {
      const threadSegment = resolveThreadSegment(threadId)
      const retained: PendingWrite[] = []
      let retainedBytes = 0
      for (const item of pending) {
        if (item.threadSegment === threadSegment) continue
        retained.push(item)
        retainedBytes += item.bytes
      }
      pending = retained
      pendingBytes = retainedBytes
      while (drainPromise) await drainPromise
      await withDirectoryLock(baseDir, () =>
        removeThreadLogFiles(baseDir, threadSegment)
      )
    },
    close() {
      closed = true
    },
  }
}

function sensitiveLogReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>()
  return (key, value) => {
    if (key && isSensitiveLogField(key)) return "[REDACTED]"
    if (typeof value === "string") return redactSensitiveLogString(value)
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value
  }
}

function isSensitiveLogField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return (
    SENSITIVE_FIELD_NAMES.has(normalized)
    || normalized.endsWith("password")
    || normalized.endsWith("passphrase")
    || normalized.endsWith("secret")
    || normalized.endsWith("credential")
    || normalized.endsWith("privatekey")
    || normalized.endsWith("apikey")
    || normalized.endsWith("accesstoken")
    || normalized.endsWith("refreshtoken")
    || normalized.endsWith("idtoken")
    || normalized.endsWith("authtoken")
    || normalized === "token"
    || (normalized.endsWith("token") && !normalized.endsWith("tokens"))
  )
}

function redactSensitiveLogString(value: string): string {
  return value
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1 [REDACTED]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[REDACTED]")
    .replace(/\bxox[a-z]-[A-Za-z0-9-]{12,}\b/gi, "xox-[REDACTED]")
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET))=([^\s]+)/g,
      "$1=[REDACTED]"
    )
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function resolveThreadSegment(raw: string | null | undefined): string {
  if (typeof raw !== "string") return GLOBAL_THREAD_SEGMENT
  const sanitizedPrefix = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, THREAD_SEGMENT_PREFIX_MAX_CHARS)
  const readablePrefix = sanitizedPrefix || "_thread"

  const hash = createHash("sha256")
    .update(raw, "utf8")
    .digest("hex")
    .slice(0, THREAD_SEGMENT_HASH_CHARS)
  return `${readablePrefix}-${hash}`
}

function resolveStreamLabel(stream: EventNdjsonStream): string {
  return stream === "native" ? "NTIVE" : "CANON"
}

async function rotateIfNeeded(
  filePath: string,
  nextBytes: number,
  options: { readonly maxBytes: number; readonly maxFiles: number }
): Promise<void> {
  if (options.maxBytes <= 0) return
  const currentBytes = await fileSize(filePath)
  if (currentBytes + nextBytes <= options.maxBytes) return

  await fs.promises.rm(`${filePath}.${options.maxFiles}`, { force: true })
  for (let index = options.maxFiles - 1; index >= 1; index -= 1) {
    await renameIfPresent(`${filePath}.${index}`, `${filePath}.${index + 1}`)
  }
  await renameIfPresent(filePath, `${filePath}.1`)
}

async function renameIfPresent(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to)
  } catch (err) {
    if (!isMissingFileError(err)) throw err
  }
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.promises.stat(filePath)).size
  } catch (err) {
    if (isMissingFileError(err)) return 0
    throw err
  }
}

async function removeThreadLogFiles(
  baseDir: string,
  threadSegment: string
): Promise<void> {
  const stem = `${threadSegment}.log`
  let entries: string[]
  try {
    entries = await fs.promises.readdir(baseDir)
  } catch (err) {
    if (isMissingFileError(err)) return
    throw err
  }
  await Promise.all(
    entries
      .filter((entry) => entry === stem || entry.startsWith(`${stem}.`))
      .map((entry) =>
        fs.promises.rm(path.join(baseDir, entry), { force: true })
      )
  )
}

async function enforceDirectoryBudget(
  baseDir: string,
  maxDirectoryBytes: number
): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.promises.readdir(baseDir)
  } catch (err) {
    if (isMissingFileError(err)) return
    throw err
  }
  const files = (
    await Promise.all(
      entries
        .filter((entry) => /\.log(?:\.\d+)?$/.test(entry))
        .map(async (entry) => {
          const filePath = path.join(baseDir, entry)
          try {
            const stat = await fs.promises.stat(filePath)
            return stat.isFile()
              ? { filePath, size: stat.size, mtimeMs: stat.mtimeMs }
              : null
          } catch (err) {
            if (isMissingFileError(err)) return null
            throw err
          }
        })
    )
  ).filter(
    (entry): entry is { filePath: string; size: number; mtimeMs: number } =>
      entry !== null
  )
  let totalBytes = files.reduce((total, entry) => total + entry.size, 0)
  files.sort(
    (left, right) =>
      left.mtimeMs - right.mtimeMs ||
      left.filePath.localeCompare(right.filePath)
  )
  for (const entry of files) {
    if (totalBytes <= maxDirectoryBytes) break
    await fs.promises.rm(entry.filePath, { force: true })
    totalBytes -= entry.size
  }
}

async function withDirectoryLock<T>(
  baseDir: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = directoryTails.get(baseDir) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  const settled = next.then(
    () => undefined,
    () => undefined
  )
  directoryTails.set(baseDir, settled)
  try {
    return await next
  } finally {
    if (directoryTails.get(baseDir) === settled) directoryTails.delete(baseDir)
  }
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  )
}
