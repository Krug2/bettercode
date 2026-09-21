import { randomBytes } from "node:crypto"
import {
  constants as fsConstants,
  type Stats,
} from "node:fs"
import fsp, { type FileHandle } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { logger } from "../observability/logger"

export const TOOL_OUTPUT_ARCHIVE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/
export const DEFAULT_TOOL_OUTPUT_RETENTION_MS = 24 * 60 * 60 * 1_000
export const DEFAULT_TOOL_OUTPUT_MAX_FILES = 128
export const DEFAULT_TOOL_OUTPUT_MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const DEFAULT_TOOL_OUTPUT_MAX_FILES_PER_OWNER = 32
export const DEFAULT_TOOL_OUTPUT_MAX_BYTES_PER_OWNER = 64 * 1024 * 1024
export const DEFAULT_TOOL_OUTPUT_MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
export const DEFAULT_TOOL_OUTPUT_CLEANUP_INTERVAL_MS = 15 * 60 * 1_000

const METADATA_MAX_BYTES = 4 * 1024
const OWNER_ID_MAX_CHARS = 512
const MAX_ID_ALLOCATION_ATTEMPTS = 8

export interface ToolOutputArchiveStoreOptions {
  readonly directory: string
  readonly retentionMs?: number
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
  readonly maxFilesPerOwner?: number
  readonly maxBytesPerOwner?: number
  readonly maxArchiveBytes?: number
  /** Set to zero in narrow tests that do not need the periodic sweep. */
  readonly cleanupIntervalMs?: number
  readonly now?: () => number
}

export interface ToolOutputArchiveReservation {
  readonly id: string
  readonly ownerId: string
  /** Server-internal path. This value must never be serialized to a client. */
  readonly filePath: string
  readonly createdAt: number
}

export interface ToolOutputArchiveCommit {
  readonly id: string
  readonly size: number
  readonly createdAt: number
}

export interface OpenToolOutputArchive {
  readonly stream: Readable
  readonly size: number
  readonly filename: string
}

interface ArchiveMetadata {
  readonly version: 1
  readonly id: string
  readonly ownerId: string
  readonly createdAt: number
}

interface ArchiveCandidate {
  readonly id: string
  readonly ownerId: string
  readonly createdAt: number
  readonly size: number
  readonly outputPath: string
  readonly metadataPath: string
}

interface CleanupResult {
  readonly withinQuota: boolean
  readonly retainedFiles: number
  readonly retainedBytes: number
}

interface OwnerUsage {
  files: number
  bytes: number
}

const registeredStores = new Set<ToolOutputArchiveStore>()

export class ToolOutputArchiveStore {
  readonly directory: string
  readonly retentionMs: number
  readonly maxFiles: number
  readonly maxTotalBytes: number
  readonly maxFilesPerOwner: number
  readonly maxBytesPerOwner: number
  readonly maxArchiveBytes: number
  readonly cleanupIntervalMs: number

  private readonly now: () => number
  private readonly reservations = new Map<string, ToolOutputArchiveReservation>()
  private readonly activeReads = new Map<string, number>()
  private mutationTail: Promise<void> = Promise.resolve()
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private cleanupTimer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(options: ToolOutputArchiveStoreOptions) {
    this.directory = path.resolve(options.directory)
    this.retentionMs = positiveInteger(
      options.retentionMs,
      DEFAULT_TOOL_OUTPUT_RETENTION_MS,
      "retentionMs"
    )
    this.maxFiles = positiveInteger(
      options.maxFiles,
      DEFAULT_TOOL_OUTPUT_MAX_FILES,
      "maxFiles"
    )
    this.maxTotalBytes = positiveInteger(
      options.maxTotalBytes,
      DEFAULT_TOOL_OUTPUT_MAX_TOTAL_BYTES,
      "maxTotalBytes"
    )
    this.maxFilesPerOwner = positiveInteger(
      options.maxFilesPerOwner,
      DEFAULT_TOOL_OUTPUT_MAX_FILES_PER_OWNER,
      "maxFilesPerOwner"
    )
    this.maxBytesPerOwner = positiveInteger(
      options.maxBytesPerOwner,
      DEFAULT_TOOL_OUTPUT_MAX_BYTES_PER_OWNER,
      "maxBytesPerOwner"
    )
    this.maxArchiveBytes = positiveInteger(
      options.maxArchiveBytes,
      DEFAULT_TOOL_OUTPUT_MAX_ARCHIVE_BYTES,
      "maxArchiveBytes"
    )
    this.cleanupIntervalMs = nonNegativeInteger(
      options.cleanupIntervalMs,
      DEFAULT_TOOL_OUTPUT_CLEANUP_INTERVAL_MS,
      "cleanupIntervalMs"
    )
    if (
      this.maxArchiveBytes > this.maxTotalBytes
      || this.maxArchiveBytes > this.maxBytesPerOwner
    ) {
      throw new Error(
        "maxArchiveBytes must fit within both global and per-owner byte quotas"
      )
    }
    this.now = options.now ?? Date.now
    registeredStores.add(this)
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = (async () => {
      await this.cleanupInternal()
      if (!this.stopped && this.cleanupIntervalMs > 0) {
        this.cleanupTimer = setInterval(() => {
          void this.cleanup().catch((error) => {
            logger.warn(
              { err: error, directory: this.directory },
              "tool output archive cleanup failed"
            )
          })
        }, this.cleanupIntervalMs)
        this.cleanupTimer.unref?.()
      }
    })()
    return this.startPromise
  }

  async reserve(ownerId: string): Promise<ToolOutputArchiveReservation> {
    validateOwnerId(ownerId)
    await this.start()
    return this.withMutation(async () => {
      this.assertRunning()
      const capacity = await this.cleanupInternal({
        additionalReservationOwnerId: ownerId,
      })
      if (!capacity.withinQuota) {
        throw archiveStoreError(
          507,
          "Tool output archive quota is currently exhausted.",
          "TOOL_OUTPUT_ARCHIVE_QUOTA"
        )
      }

      for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
        const id = randomBytes(24).toString("base64url")
        const createdAt = this.now()
        const reservation: ToolOutputArchiveReservation = Object.freeze({
          id,
          ownerId,
          filePath: this.outputPath(id),
          createdAt,
        })
        const metadata: ArchiveMetadata = {
          version: 1,
          id,
          ownerId,
          createdAt,
        }
        try {
          await writeExclusiveFile(
            this.pendingMetadataPath(id),
            JSON.stringify(metadata)
          )
          this.reservations.set(id, reservation)
          return reservation
        } catch (error) {
          if (isErrorCode(error, "EEXIST")) continue
          await safeUnlink(this.pendingMetadataPath(id)).catch(() => undefined)
          throw error
        }
      }
      throw archiveStoreError(
        500,
        "Could not allocate a tool output archive.",
        "TOOL_OUTPUT_ARCHIVE_ALLOCATION"
      )
    })
  }

  async commit(
    reservation: ToolOutputArchiveReservation
  ): Promise<ToolOutputArchiveCommit> {
    await this.start()
    return this.withMutation(async () => {
      this.assertReservation(reservation)
      try {
        await ensurePrivateDirectory(this.directory)
        const outputStat = await safeRegularFileStat(reservation.filePath)
        if (!outputStat || outputStat.size > this.maxArchiveBytes) {
          throw archiveStoreError(
            500,
            "Tool output archive failed file safety validation.",
            "TOOL_OUTPUT_ARCHIVE_INVALID"
          )
        }

        const pendingPath = this.pendingMetadataPath(reservation.id)
        const metadata = await readMetadataFile(pendingPath)
        if (
          !metadata
          || metadata.id !== reservation.id
          || metadata.ownerId !== reservation.ownerId
          || metadata.createdAt !== reservation.createdAt
        ) {
          throw archiveStoreError(
            500,
            "Tool output archive metadata failed safety validation.",
            "TOOL_OUTPUT_ARCHIVE_INVALID"
          )
        }

        // link() is an atomic no-overwrite promotion. A forged final path,
        // including a symlink, produces EEXIST instead of being replaced.
        await fsp.link(pendingPath, this.metadataPath(reservation.id))
        await fsp.unlink(pendingPath)
        this.reservations.delete(reservation.id)

        const cleanup = await this.cleanupInternal({
          protectedIds: new Set([reservation.id]),
        })
        if (!cleanup.withinQuota) {
          throw archiveStoreError(
            507,
            "Tool output archive quota is currently exhausted.",
            "TOOL_OUTPUT_ARCHIVE_QUOTA"
          )
        }
        return {
          id: reservation.id,
          size: outputStat.size,
          createdAt: reservation.createdAt,
        }
      } catch (error) {
        this.reservations.delete(reservation.id)
        await this.discardPaths(reservation.id)
        throw error
      }
    })
  }

  async discard(reservation: ToolOutputArchiveReservation): Promise<void> {
    if (!TOOL_OUTPUT_ARCHIVE_ID_PATTERN.test(reservation.id)) return
    await this.start()
    await this.withMutation(async () => {
      const active = this.reservations.get(reservation.id)
      if (active && active !== reservation) return
      this.reservations.delete(reservation.id)
      await this.discardPaths(reservation.id)
    })
  }

  async openForRead(
    id: string,
    ownerId: string
  ): Promise<OpenToolOutputArchive | null> {
    if (!TOOL_OUTPUT_ARCHIVE_ID_PATTERN.test(id)) return null
    validateOwnerId(ownerId)
    await this.start()
    return this.withMutation(async () => {
      this.assertRunning()
      await ensurePrivateDirectory(this.directory)
      const metadata = await readMetadataFile(this.metadataPath(id))
      if (!metadata || metadata.id !== id || metadata.ownerId !== ownerId) {
        return null
      }

      const opened = await openRegularFileForRead(
        this.outputPath(id),
        this.maxArchiveBytes
      )
      if (!opened) return null

      if (opened.stat.size === 0) {
        await opened.handle.close()
        return {
          stream: Readable.from([]),
          size: 0,
          filename: `tool-output-${id.slice(0, 12)}.txt`,
        }
      }

      this.activeReads.set(id, (this.activeReads.get(id) ?? 0) + 1)
      const stream = opened.handle.createReadStream({
        autoClose: true,
        start: 0,
        // Freeze the response at the size checked above even if another
        // same-user process appends to the file while it is being streamed.
        end: opened.stat.size - 1,
      })
      stream.once("close", () => this.releaseRead(id))
      return {
        stream,
        size: opened.stat.size,
        filename: `tool-output-${id.slice(0, 12)}.txt`,
      }
    })
  }

  async cleanup(): Promise<void> {
    await this.start()
    await this.withMutation(async () => {
      if (this.stopped) return
      await this.cleanupInternal()
    })
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopped = true
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.stopPromise = (async () => {
      await this.startPromise?.catch(() => undefined)
      await this.mutationTail
      registeredStores.delete(this)
    })()
    return this.stopPromise
  }

  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private assertRunning(): void {
    if (this.stopped) {
      throw archiveStoreError(
        503,
        "Tool output archive service is shutting down.",
        "TOOL_OUTPUT_ARCHIVE_STOPPED"
      )
    }
  }

  private assertReservation(
    reservation: ToolOutputArchiveReservation
  ): void {
    if (
      !TOOL_OUTPUT_ARCHIVE_ID_PATTERN.test(reservation.id)
      || this.reservations.get(reservation.id) !== reservation
    ) {
      throw archiveStoreError(
        409,
        "Tool output archive reservation is no longer active.",
        "TOOL_OUTPUT_ARCHIVE_RESERVATION"
      )
    }
  }

  private releaseRead(id: string): void {
    const remaining = (this.activeReads.get(id) ?? 1) - 1
    if (remaining > 0) this.activeReads.set(id, remaining)
    else this.activeReads.delete(id)
  }

  private async cleanupInternal(
    options: {
      readonly additionalReservationOwnerId?: string
      readonly protectedIds?: ReadonlySet<string>
    } = {}
  ): Promise<CleanupResult> {
    await ensurePrivateDirectory(this.directory, true)
    const entries = await fsp.readdir(this.directory, { withFileTypes: true })
    const records = new Map<
      string,
      { output?: string; metadata?: string; pendingMetadata?: string }
    >()
    for (const entry of entries) {
      const parsed = parseManagedFilename(entry.name)
      if (!parsed) continue
      const record = records.get(parsed.id) ?? {}
      const entryPath = path.join(this.directory, entry.name)
      if (parsed.kind === "output") record.output = entryPath
      else if (parsed.kind === "metadata") record.metadata = entryPath
      else record.pendingMetadata = entryPath
      records.set(parsed.id, record)
    }

    const candidates: ArchiveCandidate[] = []
    for (const [id, record] of records) {
      if (this.reservations.has(id)) continue

      if (record.pendingMetadata) {
        if (record.metadata) {
          await safeUnlink(record.pendingMetadata)
        } else {
          await safeUnlink(record.pendingMetadata)
          if (record.output) await safeUnlink(record.output)
          continue
        }
      }

      if (!record.metadata) {
        if (record.output) await safeUnlink(record.output)
        continue
      }
      if (!record.output) {
        await safeUnlink(record.metadata)
        continue
      }

      const metadata = await readMetadataFile(record.metadata)
      const outputStat = await safeRegularFileStat(record.output)
      const metadataStat = await safeRegularFileStat(record.metadata)
      if (
        !metadata
        || metadata.id !== id
        || !outputStat
        || !metadataStat
        || outputStat.size > this.maxArchiveBytes
      ) {
        await Promise.all([
          safeUnlink(record.metadata),
          safeUnlink(record.output),
        ])
        continue
      }
      const createdAt =
        Number.isFinite(metadata.createdAt)
        && metadata.createdAt >= 0
        && metadata.createdAt <= this.now() + 5 * 60 * 1_000
          ? metadata.createdAt
          : Math.min(metadataStat.mtimeMs, outputStat.mtimeMs)
      candidates.push({
        id,
        ownerId: metadata.ownerId,
        createdAt,
        size: outputStat.size,
        outputPath: record.output,
        metadataPath: record.metadata,
      })
    }

    candidates.sort((left, right) => right.createdAt - left.createdAt)
    const reservationOwners = [
      ...this.reservations.values(),
      ...(options.additionalReservationOwnerId
        ? [{
            ownerId: options.additionalReservationOwnerId,
          } as Pick<ToolOutputArchiveReservation, "ownerId">]
        : []),
    ]
    let retainedFiles = reservationOwners.length
    let retainedBytes = reservationOwners.length * this.maxArchiveBytes
    const ownerUsage = new Map<string, OwnerUsage>()
    for (const reservation of reservationOwners) {
      const usage = ownerUsage.get(reservation.ownerId) ?? { files: 0, bytes: 0 }
      usage.files += 1
      usage.bytes += this.maxArchiveBytes
      ownerUsage.set(reservation.ownerId, usage)
    }

    const now = this.now()
    for (const candidate of candidates) {
      const usage = ownerUsage.get(candidate.ownerId) ?? { files: 0, bytes: 0 }
      const protectedArchive =
        options.protectedIds?.has(candidate.id) === true
        || this.activeReads.has(candidate.id)
      const expired = now - candidate.createdAt > this.retentionMs
      const exceedsQuota =
        retainedFiles >= this.maxFiles
        || retainedBytes + candidate.size > this.maxTotalBytes
        || usage.files >= this.maxFilesPerOwner
        || usage.bytes + candidate.size > this.maxBytesPerOwner

      if (!protectedArchive && (expired || exceedsQuota)) {
        await Promise.all([
          safeUnlink(candidate.metadataPath),
          safeUnlink(candidate.outputPath),
        ])
        continue
      }
      retainedFiles += 1
      retainedBytes += candidate.size
      usage.files += 1
      usage.bytes += candidate.size
      ownerUsage.set(candidate.ownerId, usage)
    }

    const ownerWithinQuota = [...ownerUsage.values()].every(
      (usage) =>
        usage.files <= this.maxFilesPerOwner
        && usage.bytes <= this.maxBytesPerOwner
    )
    return {
      withinQuota:
        retainedFiles <= this.maxFiles
        && retainedBytes <= this.maxTotalBytes
        && ownerWithinQuota,
      retainedFiles,
      retainedBytes,
    }
  }

  private async discardPaths(id: string): Promise<void> {
    await ensurePrivateDirectory(this.directory)
    await Promise.all([
      safeUnlink(this.outputPath(id)),
      safeUnlink(this.pendingMetadataPath(id)),
      safeUnlink(this.metadataPath(id)),
    ])
  }

  private outputPath(id: string): string {
    return this.managedPath(id, ".txt")
  }

  private metadataPath(id: string): string {
    return this.managedPath(id, ".json")
  }

  private pendingMetadataPath(id: string): string {
    return this.managedPath(id, ".pending.json")
  }

  private managedPath(id: string, suffix: string): string {
    if (!TOOL_OUTPUT_ARCHIVE_ID_PATTERN.test(id)) {
      throw new Error("Invalid tool output archive id")
    }
    const candidate = path.join(this.directory, `${id}${suffix}`)
    const relative = path.relative(this.directory, candidate)
    if (
      relative.startsWith(`..${path.sep}`)
      || relative === ".."
      || path.isAbsolute(relative)
    ) {
      throw new Error("Tool output archive path escaped its managed directory")
    }
    return candidate
  }
}

export async function stopAllToolOutputArchiveStores(): Promise<void> {
  const stores = [...registeredStores]
  const results = await Promise.allSettled(stores.map((store) => store.stop()))
  const failures = results
    .filter((result): result is PromiseRejectedResult =>
      result.status === "rejected"
    )
    .map((result) => result.reason)
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more tool output archive stores failed to stop"
    )
  }
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return resolved
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return resolved
}

function validateOwnerId(ownerId: string): void {
  if (
    typeof ownerId !== "string"
    || ownerId.length === 0
    || ownerId.length > OWNER_ID_MAX_CHARS
  ) {
    throw archiveStoreError(
      400,
      "Invalid tool output archive owner.",
      "TOOL_OUTPUT_ARCHIVE_OWNER"
    )
  }
}

function parseManagedFilename(
  filename: string
): { id: string; kind: "output" | "metadata" | "pending" } | null {
  const match = /^([A-Za-z0-9_-]{32})(\.txt|\.json|\.pending\.json)$/.exec(
    filename
  )
  if (!match) return null
  return {
    id: match[1]!,
    kind:
      match[2] === ".txt"
        ? "output"
        : match[2] === ".json"
          ? "metadata"
          : "pending",
  }
}

async function writeExclusiveFile(filePath: string, value: string): Promise<void> {
  const flags =
    fsConstants.O_CREAT
    | fsConstants.O_EXCL
    | fsConstants.O_WRONLY
    | noFollowFlag()
  const handle = await fsp.open(filePath, flags, 0o600)
  try {
    await handle.writeFile(value, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function readMetadataFile(
  filePath: string
): Promise<ArchiveMetadata | null> {
  const opened = await openRegularFileForRead(filePath, METADATA_MAX_BYTES)
  if (!opened) return null
  try {
    const raw = await opened.handle.readFile("utf8")
    const parsed = JSON.parse(raw) as Partial<ArchiveMetadata>
    if (
      parsed.version !== 1
      || typeof parsed.id !== "string"
      || !TOOL_OUTPUT_ARCHIVE_ID_PATTERN.test(parsed.id)
      || typeof parsed.ownerId !== "string"
      || parsed.ownerId.length === 0
      || parsed.ownerId.length > OWNER_ID_MAX_CHARS
      || typeof parsed.createdAt !== "number"
      || !Number.isFinite(parsed.createdAt)
    ) {
      return null
    }
    return parsed as ArchiveMetadata
  } catch {
    return null
  } finally {
    await opened.handle.close()
  }
}

async function openRegularFileForRead(
  filePath: string,
  maxBytes: number
): Promise<{
  handle: FileHandle
  stat: Stats
} | null> {
  const before = await safeRegularFileStat(filePath)
  if (!before || before.size > maxBytes) return null
  let handle: FileHandle | null = null
  try {
    handle = await fsp.open(
      filePath,
      fsConstants.O_RDONLY | noFollowFlag()
    )
    const after = await handle.stat()
    if (
      !after.isFile()
      || after.isSymbolicLink()
      || after.nlink !== 1
      || after.size > maxBytes
      || !sameFileIdentity(before, after)
    ) {
      await handle.close()
      return null
    }
    return { handle, stat: after }
  } catch {
    await handle?.close().catch(() => undefined)
    return null
  }
}

async function safeRegularFileStat(filePath: string): Promise<Stats | null> {
  const stat = await fsp.lstat(filePath).catch(() => null)
  return stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
    ? stat
    : null
}

async function ensurePrivateDirectory(
  directory: string,
  tightenPermissions = false
): Promise<void> {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fsp.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw archiveStoreError(
      500,
      "Tool output archive directory failed safety validation.",
      "TOOL_OUTPUT_ARCHIVE_DIRECTORY"
    )
  }
  if (tightenPermissions) {
    // mkdir's mode does not tighten an already-existing directory.
    await fsp.chmod(directory, 0o700)
  }
}

function sameFileIdentity(before: Stats, after: Stats): boolean {
  if (before.ino !== 0 || after.ino !== 0) {
    return (
      before.ino === after.ino
      // Node reports lstat().dev as zero but fstat().dev as the volume serial
      // on Windows. The file index (`ino`) remains stable across both calls.
      && (process.platform === "win32" || before.dev === after.dev)
    )
  }
  // Some filesystems do not expose inode numbers. Refuse a changed timestamp
  // or size across lstat/open/fstat rather than silently following a swap.
  return (
    before.size === after.size
    && before.birthtimeMs === after.birthtimeMs
    && before.mtimeMs === after.mtimeMs
  )
}

async function safeUnlink(filePath: string): Promise<void> {
  await fsp.unlink(filePath).catch((error) => {
    if (!isErrorCode(error, "ENOENT")) throw error
  })
}

function noFollowFlag(): number {
  return process.platform === "win32"
    ? 0
    : (fsConstants.O_NOFOLLOW ?? 0)
}

function archiveStoreError(
  statusCode: number,
  message: string,
  code: string
): Error {
  return Object.assign(new Error(message), { statusCode, code })
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code
  )
}
