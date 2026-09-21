import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Per-thread scratch workspaces for chats that have no project folder.
 *
 * Agent Mode used to refuse to run at all without an open folder, which made
 * "just talk to me about an idea" impossible. The refusal was not arbitrary:
 * with no project path the provider adapters fall back to `process.cwd()`,
 * which is BetterC0de's own installation directory — so an unconstrained
 * agent would have been handed file and shell tools rooted in the app itself.
 *
 * A scratch workspace gives such a chat a real, private directory instead.
 * Built-in file tools are confined to this root. Approved shell commands run
 * under the user's account and can address paths outside it; this directory
 * is not an OS sandbox. When the user forks into a repository, its contents
 * can come along.
 *
 * The path is derived from the thread id rather than stored, so it survives
 * restarts without a migration and cannot drift out of sync with the thread.
 */

const SCRATCH_DIR_NAME = "scratch"

/** Thread ids are UUIDs, but never build a path from unvalidated input. */
const SAFE_THREAD_ID = /^[A-Za-z0-9_-]{1,128}$/

export function scratchWorkspaceRoot(dataDir: string): string {
  return path.join(dataDir, SCRATCH_DIR_NAME)
}

/**
 * The directory a project-less thread would use. Pure — it neither creates
 * anything nor checks existence, so it is safe on any code path. Returns null
 * rather than throwing for an absent data dir, because narrow unit-test states
 * construct an AppState without one.
 */
export function scratchWorkspacePathFor(
  dataDir: string | null | undefined,
  threadId: string
): string | null {
  const base = dataDir?.trim()
  if (!base) return null
  const id = threadId.trim()
  if (!SAFE_THREAD_ID.test(id)) return null
  return path.join(scratchWorkspaceRoot(base), id)
}

/**
 * Creates the directory if needed and returns its canonical path. A failure
 * to create it yields null rather than an exception: the caller then falls
 * back to the "open a project folder" path, which is a far better outcome for
 * the user than a failed turn.
 */
export async function ensureScratchWorkspace(
  dataDir: string | null | undefined,
  threadId: string
): Promise<string | null> {
  const target = scratchWorkspacePathFor(dataDir, threadId)
  if (!target) return null
  try {
    await fs.mkdir(target, { recursive: true })
  } catch {
    return null
  }
  // Canonicalized because every workspace comparison in the app is done on
  // real paths, and on macOS the data dir is typically behind a symlink.
  return await fs.realpath(target).catch(() => target)
}

/**
 * Whether `candidate` is the scratch tree or inside it. Used to approve these
 * roots without registering them as projects — they are app-owned space, so
 * containment is the whole authorization check.
 */
export function isScratchWorkspacePath(
  dataDir: string | null | undefined,
  candidate: string
): boolean {
  const base = dataDir?.trim()
  if (!base) return false
  const root = canonicalPath(scratchWorkspaceRoot(base))
  const resolved = canonicalPath(candidate)
  if (resolved === root) return true
  const relative = path.relative(root, resolved)
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  )
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value)
  if (process.platform !== "win32") return resolved
  try {
    return fsSync.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export interface ScratchCopyResult {
  readonly copied: number
  readonly skipped: ReadonlyArray<string>
  /** True when a cap stopped the copy; the repository got a partial set. */
  readonly truncated: boolean
}

/**
 * Caps on a fork copy. The scratch tree is agent-written and unbounded; the
 * destination is the user's repository, so a runaway scratch (an `npm
 * install`, a cloned repo) must not be poured in wholesale.
 */
export const SCRATCH_COPY_MAX_FILES = 5_000
export const SCRATCH_COPY_MAX_BYTES = 256 * 1024 * 1024
/** Never worth carrying into a repository; regenerated or already tracked. */
const SCRATCH_COPY_SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"])

export interface ScratchCopyLimits {
  readonly maxFiles?: number
  readonly maxBytes?: number
}

/**
 * Copies a scratch workspace's contents into a real project folder when the
 * chat is forked into a repository. Existing files are never overwritten —
 * the repository is the user's, and silently clobbering their work to deliver
 * a convenience would be the worse failure.
 */
export async function copyScratchWorkspaceInto(
  scratchPath: string,
  destination: string,
  limits: ScratchCopyLimits = {}
): Promise<ScratchCopyResult> {
  const maxFiles = limits.maxFiles ?? SCRATCH_COPY_MAX_FILES
  const maxBytes = limits.maxBytes ?? SCRATCH_COPY_MAX_BYTES
  const skipped: string[] = []
  let copied = 0
  let copiedBytes = 0
  let truncated = false

  const walk = async (from: string, to: string): Promise<void> => {
    const entries = await fs.readdir(from, { withFileTypes: true })
    // Deterministic order so a cap cuts the same files on every filesystem.
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (entry.isDirectory()) {
        if (SCRATCH_COPY_SKIPPED_DIRECTORIES.has(entry.name)) continue
        try {
          await fs.mkdir(target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }
        // Existing repository links must never redirect adoption outside the
        // selected root. A file/directory collision is skipped like a file.
        const targetStat = await fs.lstat(target)
        if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
          skipped.push(path.relative(scratchPath, source))
          continue
        }
        await walk(source, target)
        continue
      }
      if (!entry.isFile()) continue
      const exists = await fs
        .lstat(target)
        .then(() => true)
        .catch(() => false)
      if (exists) {
        skipped.push(path.relative(scratchPath, source))
        continue
      }
      const { size } = await fs.stat(source)
      if (copied >= maxFiles || copiedBytes + size > maxBytes) {
        truncated = true
        return
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      try {
        // The destination may be created after the existence check above.
        // Enforce the no-overwrite promise at the actual filesystem mutation.
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        skipped.push(path.relative(scratchPath, source))
        continue
      }
      copied += 1
      copiedBytes += size
    }
  }

  const hasScratch = await fs
    .stat(scratchPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false)
  if (!hasScratch) return { copied: 0, skipped: [], truncated: false }

  await fs.mkdir(destination, { recursive: true })
  await walk(scratchPath, destination)
  return { copied, skipped, truncated }
}
