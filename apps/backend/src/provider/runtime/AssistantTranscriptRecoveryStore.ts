import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { ThreadMessageUpsertRequest } from "../../services/threads/types"

const DEFAULT_MAX_FILES = 2_000
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
const CURRENT_RECORD_FILE =
  /^\d{13}-\d{13}-[a-f0-9]{16}-[a-f0-9]{16}-[a-f0-9-]{36}\.json$/
const LEGACY_RECORD_FILE =
  /^\d{13}-\d{13}-[a-f0-9]{32}-[a-f0-9-]{36}\.json$/

interface RecoveryEnvelope {
  readonly version: 1
  readonly queuedAt: string
  readonly reason: "retry_exhausted" | "memory_pressure" | "shutdown"
  readonly truncated: boolean
  readonly payloadBytes: number
  readonly checksum: string
  readonly request: ThreadMessageUpsertRequest
}

export interface AssistantTranscriptRecoveryTarget {
  upsertMessage(request: ThreadMessageUpsertRequest): void
}

export interface AssistantTranscriptRecoveryLogger {
  warn(bindings: Record<string, unknown>, message: string): void
  error(bindings: Record<string, unknown>, message: string): void
}

export interface AssistantTranscriptReplayResult {
  readonly replayed: number
  readonly discarded: number
  readonly quarantined: number
  readonly pending: number
}

export interface AssistantTranscriptReplayOptions {
  readonly maxRecords?: number
}

/**
 * Independent filesystem spool for final assistant messages that could not be
 * committed to SQLite. Records are immutable and uniquely named; deterministic
 * message IDs make duplicate replay safe at the database boundary.
 */
export class AssistantTranscriptRecoveryStore {
  private readonly maxFiles: number
  private readonly maxBytes: number
  private replaying = false

  constructor(
    private readonly directory: string,
    private readonly options: {
      readonly maxFiles?: number
      readonly maxBytes?: number
      readonly now?: () => Date
      readonly logger?: AssistantTranscriptRecoveryLogger
    } = {}
  ) {
    this.maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES)
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  enqueue(
    request: ThreadMessageUpsertRequest,
    metadata: {
      readonly reason: "retry_exhausted" | "memory_pressure" | "shutdown"
      readonly truncated: boolean
    }
  ): boolean {
    const queuedAt = (this.options.now?.() ?? new Date()).toISOString()
    const requestJson = JSON.stringify(request)
    const envelope: RecoveryEnvelope = {
      version: 1,
      queuedAt,
      reason: metadata.reason,
      truncated: metadata.truncated,
      payloadBytes: Buffer.byteLength(requestJson, "utf8"),
      checksum: createHash("sha256").update(requestJson, "utf8").digest("hex"),
      request,
    }
    const serialized = `${JSON.stringify(envelope)}\n`
    const bytes = Buffer.byteLength(serialized, "utf8")
    const targetPath = this.recordPath(request, queuedAt)
    const footprint = directoryFootprint(this.directory)
    if (
      bytes > this.maxBytes ||
      footprint.files >= this.maxFiles ||
      footprint.bytes + bytes > this.maxBytes
    ) {
      this.options.logger?.error(
        {
          thread: request.thread_id,
          messageId: request.message.message_id,
          bytes,
          currentBytes: footprint.bytes,
          currentFiles: footprint.files,
          maxBytes: this.maxBytes,
          maxFiles: this.maxFiles,
        },
        "assistant transcript recovery spool is full"
      )
      return false
    }

    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
    let descriptor: number | null = null
    try {
      descriptor = fs.openSync(temporaryPath, "wx", 0o600)
      fs.writeFileSync(descriptor, serialized, "utf8")
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor)
      descriptor = null
      fs.renameSync(temporaryPath, targetPath)
      fsyncDirectoryBestEffort(this.directory)
      return true
    } catch (err) {
      this.options.logger?.error(
        {
          err,
          thread: request.thread_id,
          messageId: request.message.message_id,
        },
        "failed to write assistant transcript recovery record"
      )
      return false
    } finally {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor)
        } catch {
          // Best effort cleanup after the primary write failure.
        }
      }
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {
        // Best effort cleanup after the primary write failure.
      }
    }
  }

  replay(
    target: AssistantTranscriptRecoveryTarget,
    options: AssistantTranscriptReplayOptions = {}
  ): AssistantTranscriptReplayResult {
    if (this.replaying) {
      return {
        replayed: 0,
        discarded: 0,
        quarantined: 0,
        pending: this.recordFiles().length,
      }
    }
    this.replaying = true
    let replayed = 0
    let discarded = 0
    let quarantined = 0
    const blockedThreads = new Set<string>()
    const blockedThreadHashes = new Set<string>()
    const maxRecords = positiveInteger(options.maxRecords, Number.MAX_SAFE_INTEGER)
    let examinedRecords = 0
    try {
      for (const fileName of this.recordFiles()) {
        const fileOwnerHash = recoveryThreadHashFromFileName(fileName)
        if (fileOwnerHash && blockedThreadHashes.has(fileOwnerHash)) continue
        if (examinedRecords >= maxRecords) break
        examinedRecords += 1
        const filePath = path.join(this.directory, fileName)
        let envelope: RecoveryEnvelope
        try {
          envelope = parseEnvelope(fs.readFileSync(filePath, "utf8"))
        } catch (err) {
          quarantined += 1
          this.quarantine(filePath, err)
          continue
        }
        if (blockedThreads.has(envelope.request.thread_id)) continue
        try {
          target.upsertMessage(envelope.request)
          fs.rmSync(filePath, { force: true })
          fsyncDirectoryBestEffort(this.directory)
          replayed += 1
        } catch (err) {
          if (isMissingThreadError(err)) {
            fs.rmSync(filePath, { force: true })
            fsyncDirectoryBestEffort(this.directory)
            discarded += 1
            this.options.logger?.warn(
              {
                thread: envelope.request.thread_id,
                messageId: envelope.request.message.message_id,
              },
              "discarded transcript recovery record for deleted thread"
            )
            continue
          }
          this.options.logger?.warn(
            {
              err,
              thread: envelope.request.thread_id,
              messageId: envelope.request.message.message_id,
            },
            "assistant transcript recovery replay remains pending"
          )
          if (isGlobalRecoveryStoreError(err)) break
          // Preserve ordering within one thread without blocking independent
          // threads behind a record-specific failure.
          blockedThreads.add(envelope.request.thread_id)
          blockedThreadHashes.add(
            fileOwnerHash ?? recoveryThreadHash(envelope.request.thread_id)
          )
        }
      }
    } finally {
      this.replaying = false
    }
    return {
      replayed,
      discarded,
      quarantined,
      pending: this.recordFiles().length,
    }
  }

  pendingCount(): number {
    return this.recordFiles().length
  }

  removeThread(threadId: string): number {
    let removed = 0
    for (const fileName of this.recordFiles()) {
      const filePath = path.join(this.directory, fileName)
      let envelope: RecoveryEnvelope
      try {
        envelope = parseEnvelope(fs.readFileSync(filePath, "utf8"))
      } catch (err) {
        this.quarantine(filePath, err)
        continue
      }
      if (envelope.request.thread_id !== threadId) continue
      fs.rmSync(filePath, { force: true })
      fsyncDirectoryBestEffort(this.directory)
      removed += 1
    }
    removed += this.removeQuarantinedThreadRecords(threadId)
    return removed
  }

  private recordPath(
    request: ThreadMessageUpsertRequest,
    queuedAt: string
  ): string {
    const ownerHash = recoveryThreadHash(request.thread_id)
    const messageHash = createHash("sha256")
      .update(request.message.message_id, "utf8")
      .digest("hex")
      .slice(0, 16)
    const created = sortableTimestamp(request.message.created_at)
    const queued = sortableTimestamp(queuedAt)
    return path.join(
      this.directory,
      `${created}-${queued}-${ownerHash}-${messageHash}-${randomUUID()}.json`
    )
  }

  private recordFiles(): string[] {
    try {
      return fs
        .readdirSync(this.directory)
        .filter(
          (fileName) =>
            CURRENT_RECORD_FILE.test(fileName) || LEGACY_RECORD_FILE.test(fileName)
        )
        .sort()
    } catch (err) {
      if (isMissingFileError(err)) return []
      throw err
    }
  }

  private removeQuarantinedThreadRecords(threadId: string): number {
    const quarantineDirectory = path.join(this.directory, "quarantine")
    let removed = 0
    let fileNames: string[]
    try {
      fileNames = fs.readdirSync(quarantineDirectory)
    } catch (err) {
      if (isMissingFileError(err)) return 0
      throw err
    }
    for (const fileName of fileNames) {
      const filePath = path.join(quarantineDirectory, fileName)
      const ownerHash = recoveryThreadHashFromQuarantineFileName(fileName)
      const lenientThreadId = lenientRecoveryThreadId(filePath)
      const belongsToThread =
        ownerHash === recoveryThreadHash(threadId) || lenientThreadId === threadId
      const attributableToAnotherThread =
        !belongsToThread && (ownerHash !== null || lenientThreadId !== null)
      if (attributableToAnotherThread) continue
      // Legacy malformed records may have neither a reversible owner hash nor
      // parseable metadata. They can never replay, so hard-delete favors data
      // minimization over retaining an unassignable transcript indefinitely.
      fs.rmSync(filePath, { force: true })
      removed += 1
    }
    if (removed > 0) fsyncDirectoryBestEffort(quarantineDirectory)
    return removed
  }

  private quarantine(filePath: string, error: unknown): string | null {
    const quarantineDirectory = path.join(this.directory, "quarantine")
    const destination = path.join(
      quarantineDirectory,
      `${path.basename(filePath)}.${Date.now()}.bad`
    )
    try {
      fs.mkdirSync(quarantineDirectory, { recursive: true, mode: 0o700 })
      fs.renameSync(filePath, destination)
      fsyncDirectoryBestEffort(quarantineDirectory)
    } catch (quarantineError) {
      this.options.logger?.error(
        { err: quarantineError, filePath },
        "failed to quarantine invalid transcript recovery record"
      )
      return null
    }
    this.options.logger?.error(
      { err: error, filePath },
      "invalid transcript recovery record quarantined"
    )
    return destination
  }
}

function parseEnvelope(raw: string): RecoveryEnvelope {
  const value = JSON.parse(raw) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery envelope must be an object.")
  }
  const envelope = value as Record<string, unknown>
  const request = envelope.request
  if (
    envelope.version !== 1 ||
    typeof envelope.queuedAt !== "string" ||
    !["retry_exhausted", "memory_pressure", "shutdown"].includes(
      String(envelope.reason)
    ) ||
    typeof envelope.truncated !== "boolean" ||
    typeof envelope.payloadBytes !== "number" ||
    typeof envelope.checksum !== "string" ||
    !request ||
    typeof request !== "object" ||
    Array.isArray(request)
  ) {
    throw new Error("Recovery envelope metadata is invalid.")
  }
  const candidate = request as Record<string, unknown>
  const message = candidate.message
  if (
    typeof candidate.thread_id !== "string" ||
    !message ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    throw new Error("Recovery request is invalid.")
  }
  const candidateMessage = message as Record<string, unknown>
  if (
    typeof candidateMessage.message_id !== "string" ||
    candidateMessage.role !== "assistant" ||
    typeof candidateMessage.content !== "string" ||
    typeof candidateMessage.created_at !== "string"
  ) {
    throw new Error("Recovery message is invalid.")
  }
  const requestJson = JSON.stringify(request)
  if (
    Buffer.byteLength(requestJson, "utf8") !== envelope.payloadBytes ||
    createHash("sha256").update(requestJson, "utf8").digest("hex") !==
      envelope.checksum
  ) {
    throw new Error("Recovery payload checksum or byte length is invalid.")
  }
  return value as RecoveryEnvelope
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function isGlobalRecoveryStoreError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  const code = String((error as { code?: unknown }).code ?? "")
  return [
    "SQLITE_BUSY",
    "SQLITE_LOCKED",
    "SQLITE_IOERR",
    "SQLITE_FULL",
    "SQLITE_READONLY",
    "SQLITE_CANTOPEN",
    "SQLITE_CORRUPT",
    "SQLITE_NOTADB",
  ].some((prefix) => code === prefix || code.startsWith(`${prefix}_`))
}

function isMissingThreadError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  )
}

function isMissingFileError(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT")
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  )
}

function sortableTimestamp(value: string): string {
  const parsed = Date.parse(value)
  const timestamp = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  return String(timestamp).padStart(13, "0").slice(-13)
}

function recoveryThreadHash(threadId: string): string {
  return createHash("sha256").update(threadId, "utf8").digest("hex").slice(0, 16)
}

function recoveryThreadHashFromQuarantineFileName(
  fileName: string
): string | null {
  return (
    /^\d{13}-\d{13}-([a-f0-9]{16})-[a-f0-9]{16}-[a-f0-9-]{36}\.json(?:\.\d+\.bad)?$/.exec(
      fileName
    )?.[1] ?? null
  )
}

function recoveryThreadHashFromFileName(fileName: string): string | null {
  return (
    /^\d{13}-\d{13}-([a-f0-9]{16})-[a-f0-9]{16}-[a-f0-9-]{36}\.json$/.exec(
      fileName
    )?.[1] ?? null
  )
}

function lenientRecoveryThreadId(filePath: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const request = (value as { request?: unknown }).request
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return null
    }
    const threadId = (request as { thread_id?: unknown }).thread_id
    return typeof threadId === "string" ? threadId : null
  } catch {
    return null
  }
}

function directoryFootprint(directory: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (err) {
    if (isMissingFileError(err)) return { files, bytes }
    throw err
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const nested = directoryFootprint(entryPath)
      files += nested.files
      bytes += nested.bytes
      continue
    }
    try {
      const stat = fs.lstatSync(entryPath)
      files += 1
      bytes += stat.size
    } catch (err) {
      if (!isMissingFileError(err)) throw err
    }
  }
  return { files, bytes }
}

function fsyncDirectoryBestEffort(directory: string): void {
  let descriptor: number | null = null
  try {
    descriptor = fs.openSync(directory, "r")
    fs.fsyncSync(descriptor)
  } catch {
    // Directory fsync is not supported on every platform (notably Windows).
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor)
      } catch {
        // The durable record operation already completed.
      }
    }
  }
}
