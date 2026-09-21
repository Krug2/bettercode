/**
 * Ref, branch, remote and URL validation, plus HEAD and common-dir
 * resolution. Anything that turns caller input into a git argument
 * passes through here first.
 */

import { CHECKPOINT_REFS_PREFIX } from "@betterc0de/schema"
import fs from "node:fs"
import path from "node:path"
import {
  gitRun,
  isMissingRevisionError,
} from "./process"

export function validateGitRefName(value: string, label = "Git ref"): string {
  const ref = value.trim()
  const hasControlCharacter = Array.from(ref).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x20 || codePoint === 0x7f
  })
  if (!ref || ref.length > 1_024) {
    throw Object.assign(new Error(`${label} is empty or too long.`), {
      statusCode: 400,
    })
  }
  if (
    ref.startsWith("-") ||
    hasControlCharacter ||
    /[~^:?*[\]\\]/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.split("/").some((part) => !part || part.endsWith(".lock"))
  ) {
    throw Object.assign(new Error(`${label} is not a valid Git ref name.`), {
      statusCode: 400,
    })
  }
  return ref
}

export function validateGitRemoteName(value: string): string {
  const remote = value.trim()
  if (
    remote.length === 0 ||
    remote.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
  ) {
    throw Object.assign(new Error("Invalid Git remote name."), {
      statusCode: 400,
    })
  }
  return remote
}

export function validateCheckpointRef(value: string): string {
  const checkpointRef = validateGitRefName(value, "Checkpoint ref")
  if (!checkpointRef.startsWith(`${CHECKPOINT_REFS_PREFIX}/`)) {
    throw Object.assign(
      new Error(
        "Checkpoint ref is outside the BetterC0de checkpoint namespace."
      ),
      { statusCode: 400 }
    )
  }
  return checkpointRef
}

/**
 * Namespace for the automatic snapshot taken immediately before a checkpoint
 * restore overwrites the worktree. Deliberately separate from
 * `CHECKPOINT_REFS_PREFIX` so turn-checkpoint retention/cleanup never prunes
 * an undo point.
 */
export const RESTORE_SAFETY_REFS_PREFIX = "refs/betterc0de/pre-restore"

export function validateRestoreSafetyRef(value: string): string {
  const safetyRef = validateGitRefName(value, "Restore safety ref")
  if (!safetyRef.startsWith(`${RESTORE_SAFETY_REFS_PREFIX}/`)) {
    throw Object.assign(
      new Error("Safety ref is outside the BetterC0de pre-restore namespace."),
      { statusCode: 400 }
    )
  }
  return safetyRef
}

export async function assertValidBranchName(
  cwd: string,
  value: string
): Promise<string> {
  const branch = validateGitRefName(value, "Branch")
  await gitRun(cwd, ["check-ref-format", "--branch", branch])
  return branch
}

export async function assertValidCheckpointRef(
  cwd: string,
  value: string
): Promise<string> {
  const checkpointRef = validateCheckpointRef(value)
  await gitRun(cwd, ["check-ref-format", checkpointRef])
  return checkpointRef
}

/**
 * S5: validate a remote URL before handing it to `git remote add`.
 *
 *   - reject `file://`, `ext::`, and any non-network scheme — they let git
 *     fetch arbitrary local paths or run arbitrary helpers
 *   - reject embedded credentials (`https://user:token@host/repo`) — they
 *     persist in `.git/config` and end up in screenshots, support bundles,
 *     and `git remote -v`
 *   - normalise the SSH shorthand `git@host:user/repo` to a parseable URL so
 *     callers see a uniform shape
 *
 * Exported for unit tests; thrown errors are user-presentable strings.
 */
export function validateRemoteUrl(url: string): string {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("Remote URL is empty")
  }
  const trimmed = url.trim()

  // SSH shorthand passes through git unchanged. We accept it but enforce a
  // strict shape so `evil:..; rm -rf` cannot ride. No whitespace, no shell
  // metas, no `..` traversal segments, no `//` collapses.
  const sshShorthand = /^git@[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+(?:\.git)?$/
  if (sshShorthand.test(trimmed)) {
    const pathPart = trimmed.split(":", 2)[1] ?? ""
    if (pathPart.includes("..") || pathPart.includes("//")) {
      throw new Error(`Refused remote URL: path traversal in ${trimmed}`)
    }
    return trimmed
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Invalid remote URL: ${trimmed}`)
  }

  const allowed = new Set([
    "https:",
    "http:",
    "ssh:",
    "git+https:",
    "git+ssh:",
    "git:",
  ])
  if (!allowed.has(parsed.protocol)) {
    throw new Error(`Refused remote URL scheme: ${parsed.protocol}`)
  }

  // SSH URLs canonically carry a username (`ssh://git@host/repo`); reject
  // *passwords* universally and reject *usernames* on http(s) (where they
  // are stored on disk in `.git/config` and leaked by `git remote -v`).
  if (parsed.password) {
    throw new Error(
      "Embedded credentials (password) are not allowed in remote URLs."
    )
  }
  const isHttpish =
    parsed.protocol === "https:" ||
    parsed.protocol === "http:" ||
    parsed.protocol === "git+https:"
  if (parsed.username && isHttpish) {
    throw new Error(
      "Embedded credentials are not allowed in HTTP(S) remote URLs. Use the system credential helper."
    )
  }

  return trimmed
}

export function canonicalizeExistingPath(value: string): string {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

export function normalizeBranchRef(value: string): string {
  return value.replace(/^refs\/heads\//, "")
}

export async function resolveGitCommonDir(cwd: string): Promise<string> {
  const { stdout } = await gitRun(cwd, ["rev-parse", "--git-common-dir"])
  const gitCommonDir = stdout.trim()
  return path.isAbsolute(gitCommonDir)
    ? gitCommonDir
    : path.resolve(cwd, gitCommonDir)
}

export async function hasHeadCommit(cwd: string): Promise<boolean> {
  return (await resolveHeadCommit(cwd)) !== null
}

export async function resolveHeadCommit(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await gitRun(cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      "HEAD",
    ])
    const sha = stdout.trim()
    return sha || null
  } catch (error) {
    if (isMissingRevisionError(error)) return null
    throw error
  }
}
