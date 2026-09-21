/**
 * Hidden checkpoint refs: capturing the worktree into a ref without
 * touching the index, restoring with a safety ref, diffing and pruning.
 */

import { randomUUID } from "node:crypto"
import { HttpError } from "../../errors"
import { logger } from "../../observability/logger"
import {
  checkpointRefForThreadTurn,
  type TurnDiffFileSummary,
} from "@betterc0de/schema"
import fs from "node:fs"
import path from "node:path"
import {
  boundDisplayDiff,
  type DisplayDiffResult,
} from "./diff"
import {
  gitRun,
  isMissingRevisionError,
} from "./process"
import {
  validateCheckpointRef,
  RESTORE_SAFETY_REFS_PREFIX,
  validateRestoreSafetyRef,
  assertValidCheckpointRef,
  resolveGitCommonDir,
  hasHeadCommit,
  resolveHeadCommit,
} from "./refs"
import {
  invalidateStatusCache,
  isRepo,
} from "./status"

const CHECKPOINT_GIT_TIMEOUT_MS = 120_000

const CHECKPOINT_DIFF_SUMMARY_MAX_FILES = 4_096

const CHECKPOINT_DIFF_SUMMARY_MAX_BYTES = 512 * 1024

// ─── Hidden checkpoint refs ─────────────────────────────────────────────────

export interface CaptureCheckpointInput {
  cwd: string
  checkpointRef: string
}

export interface RestoreCheckpointInput {
  cwd: string
  checkpointRef: string
  fallbackToHead?: boolean
}

export interface DiffCheckpointsInput {
  cwd: string
  fromCheckpointRef: string
  toCheckpointRef: string
  fallbackFromToHead?: boolean
  ignoreWhitespace?: boolean
}

export interface CheckpointDiffSummary {
  readonly files: readonly TurnDiffFileSummary[]
  readonly totalFiles: number
  readonly filesTruncated: boolean
}

export async function captureCheckpoint(
  input: CaptureCheckpointInput
): Promise<void> {
  const checkpointRef = await assertValidCheckpointRef(
    input.cwd,
    input.checkpointRef
  )
  await captureWorktreeSnapshotToRef(input.cwd, checkpointRef)
}

/**
 * Commit the entire worktree (tracked + untracked, respecting .gitignore) to
 * `ref` without touching the user's index, HEAD, or working tree.
 *
 * `ref` must already be validated by the caller — this is shared by
 * `captureCheckpoint` (turn checkpoints) and `restoreCheckpoint` (the
 * pre-restore safety snapshot), which live in different ref namespaces.
 */
async function captureWorktreeSnapshotToRef(
  cwd: string,
  checkpointRef: string,
  options: {
    /**
     * A temporary index that already went through `add -A` for this
     * worktree (the restore preview's). Reusing it lets git's stat cache
     * short-circuit the second snapshot instead of re-hashing every file.
     * Ownership stays with the caller, who removes it.
     */
    readonly reuseIndexPath?: string
    /** Safety refs retain the restore target as their parent: Undo's deletion manifest. */
    readonly restoreTargetCommit?: string
  } = {}
): Promise<void> {
  const input = { cwd }
  const ownsIndex = options.reuseIndexPath === undefined
  const tempIndexPath =
    options.reuseIndexPath ??
    path.join(
      await resolveGitCommonDir(input.cwd),
      `betterc0de-checkpoint-index-${randomUUID()}`
    )
  const checkpointEnv = checkpointEnvironment(tempIndexPath)
  const checkpointGitOptions = {
    env: checkpointEnv,
    timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
  }
  let cleanupTemporaryIndex = ownsIndex

  try {
    const treeOid = await writeWorktreeTree(input.cwd, tempIndexPath, {
      gitOptions: checkpointGitOptions,
      alreadySeeded: !ownsIndex,
    })

    const { stdout: commitStdout } = await gitRun(
      input.cwd,
      [
        "-c",
        "commit.gpgSign=false",
        "commit-tree",
        treeOid,
        ...(options.restoreTargetCommit ? ["-p", options.restoreTargetCommit] : []),
        "-m",
        `betterc0de checkpoint ref=${checkpointRef}`,
      ],
      checkpointGitOptions
    )
    const commitOid = commitStdout.trim()
    if (!commitOid)
      throw new Error("git commit-tree returned an empty commit oid")

    await gitRun(
      input.cwd,
      ["update-ref", checkpointRef, commitOid],
      checkpointGitOptions
    )
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { survivor?: unknown }).survivor === true
    ) {
      cleanupTemporaryIndex = false
    }
    throw error
  } finally {
    if (cleanupTemporaryIndex) removeTemporaryIndex(tempIndexPath)
  }
}

function checkpointEnvironment(tempIndexPath: string): NodeJS.ProcessEnv {
  // Process-local config for every git call that runs against the temporary
  // index. `GIT_CONFIG_COUNT` overrides the repository's own config without
  // rewriting it.
  const config: Array<readonly [key: string, value: string]> = [
    // The temporary index is a byte copy of the user's real index. With
    // `core.splitIndex=true` that copy carries the split-index link
    // extension, and every write to it (`update-index`, `add -A`) would
    // then emit a fresh `sharedindex.<oid>` file into the user's gitdir —
    // one per checkpoint, never garbage-collected because nothing of the
    // user's refers to it. Git drops the link extension on read when the
    // option is false, so the copy is written whole and the gitdir stays
    // untouched. The user's real index is never written through this env.
    ["core.splitIndex", "false"],
  ]
  if (process.platform === "win32") {
    // Git for Windows otherwise rejects generated Unity/npm paths that
    // exceed the legacy MAX_PATH boundary even when Node can access them.
    config.push(["core.longpaths", "true"])
  }
  const env: NodeJS.ProcessEnv = {
    GIT_INDEX_FILE: tempIndexPath,
    GIT_AUTHOR_NAME: "BetterC0de",
    GIT_AUTHOR_EMAIL: "betterc0de@users.noreply.github.com",
    GIT_COMMITTER_NAME: "BetterC0de",
    GIT_COMMITTER_EMAIL: "betterc0de@users.noreply.github.com",
    GIT_CONFIG_COUNT: String(config.length),
  }
  config.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key
    env[`GIT_CONFIG_VALUE_${index}`] = value
  })
  return env
}

function removeTemporaryIndex(tempIndexPath: string): void {
  fsRmFileQuiet(tempIndexPath)
  // A killed `git add` can leave the temporary index lock behind. Remove it
  // only after gitRun confirmed process-tree termination; an unconfirmed
  // survivor retains both paths for later diagnosis.
  fsRmFileQuiet(`${tempIndexPath}.lock`)
}

function isSurvivorError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { survivor?: unknown }).survivor === true
  )
}

/**
 * Seed a fresh temporary index by copying the repository's real index.
 *
 * `read-tree HEAD` produced an index with no stat data, so the following
 * `add -A` re-hashed every file in the worktree on every checkpoint — on a
 * large repo that is seconds per turn. The real index carries git's stat
 * cache, so unchanged files are skipped by mtime/size/inode instead of
 * content. `add -A` still brings the copy to the exact worktree state
 * (staged and unstaged changes alike), so the resulting tree is identical.
 *
 * The copy also carries the user's assume-unchanged and skip-worktree bits,
 * and `add -A` honours them: a flagged path is never re-stat'ed, so the
 * snapshot would record the index blob (HEAD's content) instead of the
 * worktree's local edit — and a later restore + undo would then destroy that
 * edit. The bits are cleared on the copy only (every call below runs with
 * `GIT_INDEX_FILE` pointing at it); the user's real index is never written.
 *
 * Returns false when there is nothing to copy (bare repository, no index
 * yet, copy failed) or the bits could not be cleared; the caller then falls
 * back to `read-tree HEAD`, which is slow but records the worktree faithfully.
 */
async function seedTemporaryIndexFromRepository(
  cwd: string,
  tempIndexPath: string,
  gitOptions: { env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<boolean> {
  try {
    const { stdout } = await gitRun(cwd, [
      "rev-parse",
      "--is-bare-repository",
      "--git-path",
      "index",
    ])
    const [bare, indexPathRaw] = stdout.split("\n").map((line) => line.trim())
    if (bare === "true" || !indexPathRaw) return false
    const indexPath = path.isAbsolute(indexPathRaw)
      ? indexPathRaw
      : path.resolve(cwd, indexPathRaw)
    await fs.promises.copyFile(indexPath, tempIndexPath)
  } catch {
    return false
  }
  try {
    await clearIndexRefreshSuppressionBits(cwd, gitOptions)
    return true
  } catch (error) {
    if (isSurvivorError(error)) throw error
    removeTemporaryIndex(tempIndexPath)
    return false
  }
}

/**
 * Clear assume-unchanged (`h`, lowercase tag) and skip-worktree (`S`) on
 * every entry of the index `gitOptions.env.GIT_INDEX_FILE` points at, so a
 * following `add -A` re-stats those paths like any other.
 *
 * Two separate `update-index` calls on purpose: `--no-assume-unchanged` and
 * `--no-skip-worktree` are mutually exclusive inside update-index (the first
 * one handled returns early and the other is silently ignored — measured on
 * git 2.49), so one combined call left the skip-worktree bit in place.
 */
async function clearIndexRefreshSuppressionBits(
  cwd: string,
  gitOptions: { env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<void> {
  const { stdout } = await gitRun(cwd, ["ls-files", "-v", "-z"], gitOptions)
  const assumeUnchanged: string[] = []
  const skipWorktree: string[] = []
  for (const entry of stdout.split("\0")) {
    if (entry.length < 3 || entry[1] !== " ") continue
    const tag = entry[0]
    const filePath = entry.slice(2)
    if (tag !== tag.toUpperCase()) assumeUnchanged.push(filePath)
    if (tag === "S" || tag === "s") skipWorktree.push(filePath)
  }
  for (const [flag, paths] of [
    ["--no-assume-unchanged", assumeUnchanged],
    ["--no-skip-worktree", skipWorktree],
  ] as const) {
    if (paths.length === 0) continue
    await gitRun(cwd, ["update-index", flag, "-z", "--stdin"], {
      ...gitOptions,
      input: paths.map((filePath) => `${filePath}\0`).join(""),
    })
  }
}

/**
 * Bring `tempIndexPath` to the worktree state and return its tree oid.
 * `alreadySeeded` skips seeding for an index a previous snapshot prepared.
 */
async function writeWorktreeTree(
  cwd: string,
  tempIndexPath: string,
  options: {
    readonly gitOptions: { env: NodeJS.ProcessEnv; timeoutMs: number }
    readonly alreadySeeded: boolean
  }
): Promise<string> {
  const { gitOptions } = options
  const seedFromHead = async () => {
    if (await hasHeadCommit(cwd)) {
      await gitRun(cwd, ["read-tree", "HEAD"], gitOptions)
    }
  }
  let seededFromRepository = false
  if (!options.alreadySeeded) {
    seededFromRepository = await seedTemporaryIndexFromRepository(
      cwd,
      tempIndexPath,
      gitOptions
    )
    if (!seededFromRepository) await seedFromHead()
  }

  try {
    await gitRun(cwd, ["add", "-A", "--", "."], gitOptions)
  } catch (error) {
    // A copied index git cannot load (split-index base in another gitdir,
    // an index format this git does not read) must not fail the
    // checkpoint: rebuild from HEAD and try once more.
    if (!seededFromRepository || isSurvivorError(error)) throw error
    removeTemporaryIndex(tempIndexPath)
    await seedFromHead()
    await gitRun(cwd, ["add", "-A", "--", "."], gitOptions)
  }
  const { stdout: treeStdout } = await gitRun(cwd, ["write-tree"], gitOptions)
  const treeOid = treeStdout.trim()
  if (!treeOid) throw new Error("git write-tree returned an empty tree oid")
  return treeOid
}

export async function hasCheckpointRef(input: {
  cwd: string
  checkpointRef: string
}): Promise<boolean> {
  return (
    (await resolveCheckpointCommit(input.cwd, input.checkpointRef)) !== null
  )
}

/**
 * Everything a restore would overwrite or delete, so the caller can tell the
 * user what they are about to lose BEFORE anything is mutated.
 *
 * `modified` are tracked files whose worktree content differs from the
 * checkpoint (this includes edits the user made by hand while the agent ran —
 * a restore reverts the whole worktree, not only agent-touched files).
 * `removed` are files that exist now but not in the checkpoint, i.e. files
 * created since — `git clean` deletes these and they are NOT recoverable from
 * the checkpoint itself.
 */
export interface CheckpointRestorePreview {
  readonly modified: readonly string[]
  readonly removed: readonly string[]
  readonly truncated: boolean
}

const RESTORE_PREVIEW_MAX_PATHS = 1_000

async function allocateRestoreIndexPath(cwd: string): Promise<string> {
  return path.join(
    await resolveGitCommonDir(cwd),
    `betterc0de-restore-preview-index-${randomUUID()}`
  )
}

/**
 * Snapshot the current worktree into a throwaway tree so a single
 * `diff-tree` can describe the delta including untracked files. Comparing
 * against the live worktree with `git diff` would miss untracked additions.
 * The temporary index is left populated so `restoreCheckpoint` can reuse it
 * for the safety snapshot without hashing the worktree a second time.
 */
async function previewCheckpointRestoreWithIndex(
  cwd: string,
  commitOid: string,
  tempIndexPath: string
): Promise<CheckpointRestorePreview | null> {
  const previewOptions = {
    env: checkpointEnvironment(tempIndexPath),
    timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
  }
  {
    const currentTree = await writeWorktreeTree(cwd, tempIndexPath, {
      gitOptions: previewOptions,
      alreadySeeded: false,
    })
    if (!currentTree) return null
    const input = { cwd }

    // checkpoint -> current. An "A" (added going forward) is a file that
    // exists now and not in the checkpoint, i.e. one `clean` would delete.
    const { stdout } = await gitRun(input.cwd, [
      "diff-tree",
      "-r",
      "--name-status",
      "-z",
      "--no-renames",
      commitOid,
      currentTree,
    ])
    const fields = stdout.split("\0").filter(Boolean)
    const modified: string[] = []
    const removed: string[] = []
    let truncated = false
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const status = fields[index]?.[0]
      const filePath = fields[index + 1]
      if (!status || !filePath) continue
      if (modified.length + removed.length >= RESTORE_PREVIEW_MAX_PATHS) {
        truncated = true
        break
      }
      if (status === "A") removed.push(filePath)
      else modified.push(filePath)
    }
    return { modified, removed, truncated }
  }
}

async function resolveRestoreCommit(
  input: RestoreCheckpointInput
): Promise<string | null> {
  const checkpointRef = await assertValidCheckpointRef(
    input.cwd,
    input.checkpointRef
  )
  const commitOid = await resolveCheckpointCommit(input.cwd, checkpointRef)
  if (commitOid) return commitOid
  return input.fallbackToHead === true
    ? await resolveHeadCommit(input.cwd)
    : null
}

export interface RestoreCheckpointResult {
  readonly restored: boolean
  /**
   * Ref holding tracked and nonignored files before restore. Excluded files
   * stay untouched; restore refuses to overwrite them. `null` when the safety
   * snapshot could not be captured and no restore ran.
   */
  readonly safetyRef: string | null
  readonly preview: CheckpointRestorePreview | null
}

export async function restoreCheckpoint(
  input: RestoreCheckpointInput
): Promise<RestoreCheckpointResult> {
  const commitOid = await resolveRestoreCommit(input)
  if (!commitOid) {
    return { restored: false, safetyRef: null, preview: null }
  }

  // Nothing consumes safety refs after their undo window, so they would
  // otherwise accumulate one commit per restore forever.
  await pruneRestoreSafetyRefs(input.cwd).catch((error) => {
    logger.warn(
      { cwd: input.cwd, err: error instanceof Error ? error.message : String(error) },
      "checkpoint restore: could not prune old pre-restore safety refs"
    )
  })

  // What is about to be lost, captured before anything is mutated. The
  // preview leaves its temporary index at the worktree state; the safety
  // snapshot below reuses it so the worktree is hashed once, not twice.
  const tempIndexPath = await allocateRestoreIndexPath(input.cwd)
  let preview: CheckpointRestorePreview | null = null
  let previewIndexReady = false
  try {
    preview = await previewCheckpointRestoreWithIndex(
      input.cwd,
      commitOid,
      tempIndexPath
    )
    previewIndexReady = true
  } catch (error) {
    // A surviving Git process may still hold this index or its lock. Stop
    // before cleanup or a fallback snapshot can race that process.
    if (isSurvivorError(error)) throw error
    preview = null
    removeTemporaryIndex(tempIndexPath)
  }

  // Snapshot the current tracked and nonignored files before any mutation.
  // Restore deletes only paths in that snapshot and leaves excluded files alone.
  const safetyRef = `${RESTORE_SAFETY_REFS_PREFIX}/${randomUUID()}`
  const verifiedSafetyRef = validateRestoreSafetyRef(safetyRef)
  let keepTemporaryIndex = false
  try {
    await captureWorktreeSnapshotToRef(
      input.cwd,
      verifiedSafetyRef,
      { ...(previewIndexReady ? { reuseIndexPath: tempIndexPath } : {}), restoreTargetCommit: commitOid }
    )
    const { stdout } = await gitRun(input.cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${verifiedSafetyRef}^{commit}`,
    ])
    if (!stdout.trim()) {
      throw new Error("pre-restore snapshot ref is empty")
    }
  } catch (error) {
    keepTemporaryIndex = isSurvivorError(error)
    return { restored: false, safetyRef: null, preview }
  } finally {
    if (previewIndexReady && !keepTemporaryIndex) {
      removeTemporaryIndex(tempIndexPath)
    }
  }

  await restoreSnapshotWorktree(input.cwd, commitOid, verifiedSafetyRef)
  await invalidateStatusCache(input.cwd)
  return { restored: true, safetyRef: verifiedSafetyRef, preview }
}

/**
 * Pre-restore safety refs older than this are pruned. A week comfortably
 * covers "I restored the wrong checkpoint yesterday" while keeping the
 * repository from growing a commit per restore indefinitely.
 */
export const RESTORE_SAFETY_REF_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Delete pre-restore safety refs whose snapshot commit is older than the
 * retention window. Runs before every restore and during thread checkpoint
 * cleanup; returns how many refs were removed.
 */
export async function pruneRestoreSafetyRefs(
  cwd: string,
  options: { readonly now?: number; readonly retentionMs?: number } = {}
): Promise<number> {
  const now = options.now ?? Date.now()
  const retentionMs = options.retentionMs ?? RESTORE_SAFETY_REF_RETENTION_MS
  const cutoffSeconds = Math.floor((now - retentionMs) / 1000)
  const { stdout } = await gitRun(cwd, [
    "for-each-ref",
    "--format=%(refname)%00%(committerdate:unix)",
    `${RESTORE_SAFETY_REFS_PREFIX}/`,
  ])
  const stale: string[] = []
  for (const line of stdout.split("\n")) {
    const [ref, dateRaw] = line.trim().split("\0")
    if (!ref || !dateRaw) continue
    const committedAt = Number.parseInt(dateRaw, 10)
    if (!Number.isFinite(committedAt) || committedAt > cutoffSeconds) continue
    stale.push(validateRestoreSafetyRef(ref))
  }
  if (stale.length === 0) return 0
  await gitRun(cwd, ["update-ref", "--stdin"], {
    input: [
      "start",
      ...stale.map((ref) => `delete ${ref}`),
      "prepare",
      "commit",
      "",
    ].join("\n"),
  })
  return stale.length
}

/**
 * Undo a restore using the pre-restore snapshot. Its first parent records the
 * snapshot that restore applied; only paths in that manifest may be removed.
 * Older parentless safety refs require manual recovery rather than guessing
 * which currently untracked files the previous restore created.
 */
export async function undoCheckpointRestore(input: {
  cwd: string
  safetyRef: string
}): Promise<boolean> {
  const safetyRef = validateRestoreSafetyRef(input.safetyRef)
  await gitRun(input.cwd, ["check-ref-format", safetyRef])
  let commitOid: string
  try {
    const { stdout } = await gitRun(input.cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${safetyRef}^{commit}`,
    ])
    commitOid = stdout.trim()
  } catch {
    return false
  }
  if (!commitOid) return false

  let restoreTarget: string
  try {
    const { stdout } = await gitRun(input.cwd, ["rev-parse", "--verify", "--quiet", `${commitOid}^`])
    restoreTarget = stdout.trim()
  } catch (error) {
    if (!isMissingRevisionError(error)) throw error
    throw new HttpError(409, "This older restore has no deletion manifest. Recover files from its safety ref manually.", "checkpoint_restore_manifest_missing")
  }
  await restoreSnapshotWorktree(input.cwd, commitOid, restoreTarget)
  await invalidateStatusCache(input.cwd)
  return true
}

/**
 * The temporary index is the deletion manifest: only paths in currentSnapshot
 * may disappear. A changed .gitignore must never broaden it.
 * Callers hold the workspace recovery fence throughout snapshot and restore.
 */
async function restoreSnapshotWorktree(
  cwd: string,
  targetCommit: string,
  currentSnapshot: string
): Promise<void> {
  const tempIndexPath = await allocateRestoreIndexPath(cwd)
  const gitOptions = { env: checkpointEnvironment(tempIndexPath), timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS }
  let keepTemporaryIndex = false
  try {
    await gitRun(cwd, ["read-tree", currentSnapshot], gitOptions)
    // Git restore can overwrite files absent from the manifest, including
    // ignored data. Refuse all such collisions and directory/file changes.
    const { stdout: unprotected } = await gitRun(cwd, [
      "ls-files", "--others", "--directory", "--full-name", "-z",
    ], gitOptions)
    if (unprotected) {
      const { stdout: target } = await gitRun(cwd, [
        "ls-tree", "-r", "--name-only", "--full-name", "-z", targetCommit, "--", ".",
      ])
      const key = (file: string) => process.platform === "win32" ? file.toLowerCase() : file
      const targetPaths = new Set(target.split("\0").filter(Boolean).map(key))
      const targetDirectories = new Set<string>()
      for (const file of targetPaths) {
        for (let parent = path.posix.dirname(file); parent !== "."; parent = path.posix.dirname(parent)) {
          targetDirectories.add(parent)
        }
      }
      for (const file of unprotected.split("\0").filter(Boolean)) {
        const unprotectedPath = key(file.replace(/\/$/, ""))
        let collision = targetPaths.has(unprotectedPath) || targetDirectories.has(unprotectedPath)
        for (let parent = path.posix.dirname(unprotectedPath); !collision && parent !== "."; parent = path.posix.dirname(parent)) {
          collision = targetPaths.has(parent)
        }
        if (collision) {
          throw new HttpError(409, "Checkpoint restore would overwrite a file absent from its deletion manifest. Move it out of the way before retrying.", "checkpoint_restore_unprotected_path")
        }
      }
    }
    await gitRun(cwd, ["restore", "--source", targetCommit, "--worktree", "--staged", "--", "."], gitOptions)
    if (await hasHeadCommit(cwd)) {
      await gitRun(cwd, ["reset", "--quiet", "--", "."])
    } else {
      await gitRun(cwd, ["restore", "--source", targetCommit, "--staged", "--", "."])
    }
  } catch (error) {
    keepTemporaryIndex = isSurvivorError(error)
    throw error
  } finally {
    if (!keepTemporaryIndex) removeTemporaryIndex(tempIndexPath)
  }
}

export async function diffCheckpoints(
  input: DiffCheckpointsInput
): Promise<DisplayDiffResult> {
  const fromCheckpointRef = await assertValidCheckpointRef(
    input.cwd,
    input.fromCheckpointRef
  )
  const toCheckpointRef = await assertValidCheckpointRef(
    input.cwd,
    input.toCheckpointRef
  )
  let fromRevision = fromCheckpointRef
  if (input.fallbackFromToHead === true) {
    fromRevision =
      (await resolveCheckpointCommit(input.cwd, fromCheckpointRef)) ??
      (await resolveHeadCommit(input.cwd)) ??
      ""
    if (!fromRevision) {
      throw new Error("Checkpoint ref is unavailable for diff operation.")
    }
  }

  const { stdout } = await gitRun(input.cwd, [
    "diff",
    "--patch",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    ...((input.ignoreWhitespace ?? true) ? ["--ignore-all-space"] : []),
    `${fromRevision}^{commit}`,
    `${toCheckpointRef}^{commit}`,
  ])
  // Same ceiling as diff(): the renderer mounts every line it receives.
  return boundDisplayDiff(stdout)
}

/**
 * Bounded fallback for checkpoint patches that exceed the full diff output
 * ceiling. `--numstat -z --no-renames` keeps filenames unambiguous while
 * avoiding file contents; the exact before/after states remain available in
 * the retained checkpoint refs.
 */
export async function summarizeCheckpointDiff(
  input: DiffCheckpointsInput
): Promise<CheckpointDiffSummary> {
  const fromCheckpointRef = await assertValidCheckpointRef(
    input.cwd,
    input.fromCheckpointRef
  )
  const toCheckpointRef = await assertValidCheckpointRef(
    input.cwd,
    input.toCheckpointRef
  )
  let fromRevision = fromCheckpointRef
  if (input.fallbackFromToHead === true) {
    fromRevision =
      (await resolveCheckpointCommit(input.cwd, fromCheckpointRef)) ??
      (await resolveHeadCommit(input.cwd)) ??
      ""
    if (!fromRevision) {
      throw new Error("Checkpoint ref is unavailable for diff operation.")
    }
  }

  const { stdout } = await gitRun(
    input.cwd,
    [
      "diff",
      "--numstat",
      "--no-renames",
      "-z",
      ...((input.ignoreWhitespace ?? true) ? ["--ignore-all-space"] : []),
      `${fromRevision}^{commit}`,
      `${toCheckpointRef}^{commit}`,
    ],
    { timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS }
  )
  return parseCheckpointNumstatSummary(stdout)
}

export function parseCheckpointNumstatSummary(
  output: string
): CheckpointDiffSummary {
  const summaries: TurnDiffFileSummary[] = []
  // Account for the surrounding JSON array. Per-entry JSON sizes include
  // escaped path characters, so the retained summary remains byte-bounded
  // even for legal but unusually long filenames.
  let summaryBytes = 2
  let totalFiles = 0
  for (const record of output.split("\0")) {
    if (!record) continue
    const firstTab = record.indexOf("\t")
    const secondTab =
      firstTab >= 0 ? record.indexOf("\t", firstTab + 1) : -1
    if (firstTab < 0 || secondTab < 0) continue
    const additions = parseNumstatCount(record.slice(0, firstTab))
    const deletions = parseNumstatCount(
      record.slice(firstTab + 1, secondTab)
    )
    const filePath = record.slice(secondTab + 1)
    if (!filePath) continue
    totalFiles += 1
    if (summaries.length >= CHECKPOINT_DIFF_SUMMARY_MAX_FILES) continue
    const summary = {
      path: filePath,
      additions,
      deletions,
    }
    const serializedSummary = JSON.stringify(summary)
    const nextSummaryBytes =
      Buffer.byteLength(serializedSummary, "utf8") +
      (summaries.length > 0 ? 1 : 0)
    if (
      summaryBytes + nextSummaryBytes >
      CHECKPOINT_DIFF_SUMMARY_MAX_BYTES
    ) {
      continue
    }
    summaries.push(summary)
    summaryBytes += nextSummaryBytes
  }
  return {
    files: summaries.sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    totalFiles,
    filesTruncated: totalFiles > summaries.length,
  }
}

function parseNumstatCount(value: string): number {
  if (value === "-") return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export async function deleteCheckpointRefs(input: {
  cwd: string
  checkpointRefs: string[]
}): Promise<void> {
  // Validate the complete set before mutating anything. The namespace/ref
  // validator rejects whitespace and control characters, so the validated
  // values are also safe for update-ref's line protocol.
  const checkpointRefs = [
    ...new Set(
      input.checkpointRefs.map((value) => validateCheckpointRef(value))
    ),
  ]
  const failures: Error[] = []
  const batchSize = 512
  for (let offset = 0; offset < checkpointRefs.length; offset += batchSize) {
    const batch = checkpointRefs.slice(offset, offset + batchSize)
    try {
      await gitRun(input.cwd, ["update-ref", "--stdin"], {
        input: [
          "start",
          ...batch.map((checkpointRef) => `delete ${checkpointRef}`),
          "prepare",
          "commit",
          "",
        ].join("\n"),
      })
    } catch (error) {
      failures.push(
        new Error(
          `Failed to delete checkpoint ref batch ${offset / batchSize + 1} (${batch.length} refs): ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error }
        )
      )
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more checkpoint refs could not be deleted."
    )
  }
}

/**
 * Remove every hidden checkpoint ref owned by one thread, including orphaned
 * baseline refs that may not have reached the SQLite read model. Used only
 * after the thread's provider/turn teardown gates have been acquired.
 */
export async function deleteThreadCheckpointRefs(
  cwd: string,
  threadId: string
): Promise<number> {
  if (!(await isRepo(cwd)).is_repo) return 0
  await pruneRestoreSafetyRefs(cwd).catch((error) => {
    logger.warn(
      { cwd, err: error instanceof Error ? error.message : String(error) },
      "thread checkpoint cleanup: could not prune old pre-restore safety refs"
    )
  })
  const firstRef = checkpointRefForThreadTurn(threadId, 0)
  const prefix = firstRef.replace(/\/turn\/0$/, "/turn")
  const { stdout } = await gitRun(cwd, [
    "for-each-ref",
    "--format=%(refname)",
    prefix,
  ])
  const checkpointRefs = Array.from(
    new Set(
      stdout
        .split("\n")
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.startsWith(`${prefix}/`))
    )
  )
  if (checkpointRefs.length === 0) return 0
  await deleteCheckpointRefs({ cwd, checkpointRefs })
  return checkpointRefs.length
}

async function resolveCheckpointCommit(
  cwd: string,
  checkpointRef: string
): Promise<string | null> {
  const cleanCheckpointRef = await assertValidCheckpointRef(cwd, checkpointRef)
  try {
    const { stdout } = await gitRun(cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${cleanCheckpointRef}^{commit}`,
    ])
    const sha = stdout.trim()
    return sha || null
  } catch (error) {
    if (isMissingRevisionError(error)) return null
    throw error
  }
}

function fsRmFileQuiet(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // Best-effort cleanup only.
  }
}
