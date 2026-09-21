/**
 * Display diffs and hunk-level apply/revert with conflict detection.
 */

import { createHash } from "node:crypto"
import { gitRun } from "./process"
import { invalidateStatusCache } from "./status"

const TEXT_DIFF_ARGS = ["--no-color", "--binary", "--full-index"] as const

function normalizeGitPatch(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")
  return normalized.length > 0 ? `${normalized}\n` : ""
}

function extractGitHunkPatches(diffText: string): string[] {
  const lines = normalizeGitPatch(diffText).split("\n")
  if (lines.at(-1) === "") lines.pop()
  const patches: string[] = []
  let fileStart = -1

  for (let index = 0; index <= lines.length; index += 1) {
    const isFileStart = lines[index]?.startsWith("diff --git ") ?? false
    const atEnd = index === lines.length
    if (!isFileStart && !atEnd) continue

    if (fileStart >= 0) {
      const fileLines = lines.slice(fileStart, index)
      const hunkStarts: number[] = []
      for (let lineIndex = 0; lineIndex < fileLines.length; lineIndex += 1) {
        if (fileLines[lineIndex]?.startsWith("@@ ")) {
          hunkStarts.push(lineIndex)
        }
      }
      if (hunkStarts.length > 0) {
        const header = fileLines
          .slice(0, hunkStarts[0])
          .filter((line) => !line.startsWith("index "))
        for (let hunkIndex = 0; hunkIndex < hunkStarts.length; hunkIndex += 1) {
          const start = hunkStarts[hunkIndex]!
          const end = hunkStarts[hunkIndex + 1] ?? fileLines.length
          patches.push(
            normalizeGitPatch(
              [...header, ...fileLines.slice(start, end)].join("\n")
            )
          )
        }
      }
    }
    fileStart = isFileStart ? index : -1
  }

  return patches
}

function gitHunkConflict(): Error {
  return Object.assign(
    new Error(
      "This hunk no longer matches the workspace. Refresh the diff and review the latest changes."
    ),
    {
      statusCode: 409,
      code: "git_hunk_conflict",
    }
  )
}

export function gitHunkPatchId(patch: string): string {
  return createHash("sha256").update(normalizeGitPatch(patch)).digest("hex")
}

/**
 * Reconciles a prepared hunk receipt after a process restart.
 *
 * `pending` means the exact source hunk still exists and can be applied once.
 * `applied` requires positive evidence in the destination diff (stage/
 * unstage), or that the original forward patch cleanly applies after a
 * reject. Any other state is ambiguous and must be reviewed again.
 */
export async function inspectHunkActionState(input: {
  cwd: string
  path: string
  source: "unstaged" | "staged"
  action: "accept" | "reject" | "unstage"
  patch: string
  expectedPatchId?: string
}): Promise<"pending" | "applied" | "conflict"> {
  const normalizedPatch = normalizeGitPatch(input.patch)
  const patchId = gitHunkPatchId(normalizedPatch)
  if (input.expectedPatchId && input.expectedPatchId !== patchId) {
    return "conflict"
  }
  const sourceArgs =
    input.source === "staged"
      ? ["diff", "--cached", ...TEXT_DIFF_ARGS, "--", input.path]
      : ["diff", ...TEXT_DIFF_ARGS, "--", input.path]
  const sourceDiff = await gitRun(input.cwd, sourceArgs)
  if (
    extractGitHunkPatches(sourceDiff.stdout).some(
      (candidate) => candidate === normalizedPatch
    )
  ) {
    return "pending"
  }

  if (input.action === "accept" || input.action === "unstage") {
    const destinationArgs =
      input.action === "accept"
        ? ["diff", "--cached", ...TEXT_DIFF_ARGS, "--", input.path]
        : ["diff", ...TEXT_DIFF_ARGS, "--", input.path]
    const destinationDiff = await gitRun(input.cwd, destinationArgs)
    return extractGitHunkPatches(destinationDiff.stdout).some(
      (candidate) => candidate === normalizedPatch
    )
      ? "applied"
      : "conflict"
  }

  try {
    await gitRun(
      input.cwd,
      ["apply", "--whitespace=nowarn", "--check", "-"],
      { input: normalizedPatch }
    )
    return "applied"
  } catch {
    return "conflict"
  }
}

/**
 * Cap on a diff payload handed to the renderer.
 *
 * `gitRun` allows up to `GIT_OUTPUT_MAX_BYTES` (32 MiB), and the diff panel
 * parses whatever it receives into per-line objects and mounts them all. A
 * regenerated lockfile or a vendored directory therefore froze the window:
 * 32 MiB of JSON over HTTP, parsed into hundreds of thousands of nodes. Two
 * megabytes is far more than anyone reads and still shows the whole diff for
 * every realistic review.
 */
export const DISPLAY_DIFF_MAX_BYTES = 2 * 1024 * 1024

export interface DisplayDiffResult {
  readonly diff: string
  readonly truncated: boolean
  /** Total size before truncation, so the UI can say how much is hidden. */
  readonly totalBytes: number
}

export function boundDisplayDiff(raw: string): DisplayDiffResult {
  const totalBytes = Buffer.byteLength(raw, "utf8")
  if (totalBytes <= DISPLAY_DIFF_MAX_BYTES) {
    return { diff: raw, truncated: false, totalBytes }
  }
  // Cut on a line boundary so the client never has to parse half a hunk
  // header, and never split a multi-byte character.
  const head = Buffer.from(raw, "utf8")
    .subarray(0, DISPLAY_DIFF_MAX_BYTES)
    .toString("utf8")
  const lastNewline = head.lastIndexOf("\n")
  return {
    diff: lastNewline > 0 ? head.slice(0, lastNewline + 1) : head,
    truncated: true,
    totalBytes,
  }
}

export async function diff(cwd: string): Promise<DisplayDiffResult> {
  const { stdout } = await gitRun(cwd, ["diff", ...TEXT_DIFF_ARGS])
  return boundDisplayDiff(stdout)
}

export async function diffStaged(cwd: string): Promise<DisplayDiffResult> {
  const { stdout } = await gitRun(cwd, ["diff", "--cached", ...TEXT_DIFF_ARGS])
  return boundDisplayDiff(stdout)
}

export async function applyHunk(input: {
  cwd: string
  path: string
  source: "unstaged" | "staged"
  action: "accept" | "reject" | "unstage"
  patch: string
  expectedPatchId?: string
  dryRun?: boolean
}): Promise<{
  ok: true
  action: "accept" | "reject" | "unstage"
  patchId: string
  applied: boolean
}> {
  const validAction =
    (input.source === "unstaged" &&
      (input.action === "accept" || input.action === "reject")) ||
    (input.source === "staged" && input.action === "unstage")
  if (!validAction) {
    throw Object.assign(new Error("Invalid hunk action for diff source."), {
      statusCode: 400,
      code: "git_hunk_action_invalid",
    })
  }

  const normalizedPatch = normalizeGitPatch(input.patch)
  const patchId = gitHunkPatchId(normalizedPatch)
  if (input.expectedPatchId && input.expectedPatchId !== patchId) {
    throw gitHunkConflict()
  }
  const diffArgs =
    input.source === "staged"
      ? ["diff", "--cached", ...TEXT_DIFF_ARGS, "--", input.path]
      : ["diff", ...TEXT_DIFF_ARGS, "--", input.path]
  const current = await gitRun(input.cwd, diffArgs)
  const exactHunkExists = extractGitHunkPatches(current.stdout).some(
    (candidate) => candidate === normalizedPatch
  )
  if (!exactHunkExists) throw gitHunkConflict()

  const applyArgs = ["apply", "--whitespace=nowarn"]
  if (input.action === "accept") {
    applyArgs.push("--cached")
  } else if (input.action === "reject") {
    applyArgs.push("--reverse")
  } else {
    applyArgs.push("--cached", "--reverse")
  }

  try {
    await gitRun(input.cwd, [...applyArgs, "--check", "-"], {
      input: normalizedPatch,
    })
    if (!input.dryRun) {
      await gitRun(input.cwd, [...applyArgs, "-"], {
        input: normalizedPatch,
      })
    }
  } catch {
    throw gitHunkConflict()
  }

  if (!input.dryRun) await invalidateStatusCache(input.cwd)
  return {
    ok: true,
    action: input.action,
    patchId,
    applied: input.dryRun !== true,
  }
}
