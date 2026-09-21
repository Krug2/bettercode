import { invoke } from "./runtime"
import type {
  GitHunkActionInput,
  GitHunkActionResult,
  GitStatus,
} from "@betterc0de/schema"

type GitCommandResponse = Record<string, unknown> & {
  success?: boolean
  output?: string
}

type GitRepoResponse =
  | boolean
  | {
      is_repo?: boolean
      isRepo?: boolean
    }

type GitDiffResponse = Record<string, unknown> & {
  diff?: string
  diff_text?: string
  diffText?: string
  /** Server bounded the payload; what arrived is a prefix, not the whole diff. */
  truncated?: boolean
  /** Full size before truncation, so the UI can say how much is hidden. */
  totalBytes?: number
}

type NormalizedGitDiffResponse = GitDiffResponse & {
  diff: string
  diff_text: string
  diffText: string
  truncated: boolean
  totalBytes: number
}

function normalizeGitRepoResponse(result: GitRepoResponse): boolean {
  if (typeof result === "boolean") return result
  return Boolean(result.is_repo ?? result.isRepo)
}

function normalizeGitDiffResponse(
  result: GitDiffResponse
): NormalizedGitDiffResponse {
  const diffText = result.diff_text ?? result.diffText ?? result.diff ?? ""
  return {
    ...result,
    diff: diffText,
    diff_text: diffText,
    diffText,
    truncated: result.truncated === true,
    totalBytes:
      typeof result.totalBytes === "number"
        ? result.totalBytes
        : diffText.length,
  }
}

export interface GitUserProfile {
  name: string | null
  email: string | null
  githubUser: string | null
}

export const gitUserProfile = (cwd?: string | null) => {
  // Normalize a blank/whitespace cwd to null: `?? null` only catches
  // null/undefined, so an empty string (no folder open at startup) would
  // otherwise be sent verbatim and rejected by the schema's non-blank
  // gitPath rule with a 400. The backend treats a null cwd as a global
  // git-identity lookup, which is exactly what we want with no project open.
  const normalizedCwd = cwd?.trim() ? cwd : null
  return invoke<GitUserProfile>("/git/profile", {
    args: { cwd: normalizedCwd },
    method: "POST",
    body: { cwd: normalizedCwd },
  })
}

export const gitStatus = (cwd: string) =>
  invoke<GitStatus>("/git/status", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitCommit = (cwd: string, message: string) =>
  invoke<Record<string, unknown>>("/git/commit", {
    args: { cwd, message },
    method: "POST",
    body: { cwd, message },
  }).then((result) => {
    const response = result as GitCommandResponse
    if (response.success !== false) {
      window.dispatchEvent(
        new CustomEvent("betterc0de:git-commit", {
          detail: {
            cwd,
            commitMessage: message,
            output: response.output || "",
          },
        })
      )
    }
    return result
  })

export const gitPush = (
  cwd: string,
  opts: { setUpstream?: boolean; branch?: string; remote?: string } = {}
) =>
  invoke<Record<string, unknown>>("/git/push", {
    args: { cwd, ...opts },
    method: "POST",
    body: { cwd, ...opts },
    silentStatuses: [400, 401, 404, 409],
  })

export const gitFetch = (cwd: string) =>
  invoke<{ status: GitStatus }>("/git/fetch", {
    method: "POST",
    body: { cwd },
    timeoutMs: 100_000,
    silentStatuses: [400, 401, 404, 502],
  })

export const gitPull = (cwd: string) =>
  invoke<Record<string, unknown>>("/git/pull", {
    args: { cwd },
    method: "POST",
    body: { cwd },
    silentStatuses: [400, 401, 404, 409],
  })

export const gitDiscard = (cwd: string, path: string) =>
  invoke<Record<string, unknown>>("/git/discard", {
    args: { cwd, path },
    method: "POST",
    body: { cwd, path },
  })

export const openInEditor = (path: string, editor: string) =>
  invoke<void>("/git/open-editor", {
    args: { path, editor },
    method: "POST",
    body: { path, editor },
  })

/** One entry per external tool the backend probed for ("Open in" menu). */
export interface OpenTarget {
  id: string
  label: string
  group: "editor" | "tool" | "system"
  available: boolean
}

export const getOpenTargets = (opts: { refresh?: boolean } = {}) =>
  invoke<{ targets: OpenTarget[] }>(
    `/git/open-targets${opts.refresh ? "?refresh=true" : ""}`
  )

export const gitInit = (cwd: string) =>
  invoke<Record<string, unknown>>("/git/init", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const isGitRepo = (cwd: string) =>
  invoke<GitRepoResponse>("/git/is-repo", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  }).then(normalizeGitRepoResponse)

export const gitDiff = (cwd: string) =>
  invoke<GitDiffResponse>("/git/diff", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  }).then(normalizeGitDiffResponse)

export const gitDiffStaged = (cwd: string) =>
  invoke<GitDiffResponse>("/git/diff-staged", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  }).then(normalizeGitDiffResponse)

export const gitListRemotes = (cwd: string) =>
  invoke<string[]>("/git/remotes", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitAddRemote = (cwd: string, name: string, url: string) =>
  invoke<void>("/git/remotes/add", {
    args: { cwd, name, url },
    method: "POST",
    body: { cwd, name, url },
  })

export const gitStage = (cwd: string, paths: string[]) =>
  invoke<void>("/git/stage", {
    args: { cwd, paths },
    method: "POST",
    body: { cwd, paths },
  })

export const gitUnstage = (cwd: string, paths: string[]) =>
  invoke<void>("/git/unstage", {
    args: { cwd, paths },
    method: "POST",
    body: { cwd, paths },
  })

export const gitStageAll = (cwd: string) =>
  invoke<void>("/git/stage-all", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitUnstageAll = (cwd: string) =>
  invoke<void>("/git/unstage-all", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitApplyHunk = (input: GitHunkActionInput) => {
  const request = {
    ...input,
    operationId: input.operationId ?? crypto.randomUUID(),
  }
  return invoke<GitHunkActionResult>("/git/hunks/apply", {
    args: request,
    method: "POST",
    body: request,
  })
}

export const gitLog = (cwd: string, count?: number) =>
  invoke<{
    commits: { hash: string; message: string; author: string; date: string }[]
  }>("/git/log", {
    args: { cwd, count: count ?? 20 },
    method: "POST",
    body: { cwd, count: count ?? 20 },
  })

export const gitCheckoutBranch = (
  cwd: string,
  branch: string,
  create?: boolean
) =>
  invoke<void>("/git/checkout", {
    args: { cwd, branch, create: create ?? false },
    method: "POST",
    body: { cwd, branch, create: create ?? false },
  })

export const gitListBranches = (cwd: string) =>
  invoke<{ branches: string[]; current: string }>("/git/branches", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitStash = (cwd: string, message?: string) =>
  invoke<void>("/git/stash", {
    args: { cwd, message },
    method: "POST",
    body: { cwd, message },
  })

export const gitStashPop = (cwd: string) =>
  invoke<void>("/git/stash-pop", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export interface GitWorktreeInfo {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  prunable: boolean
}

export const gitListWorktrees = (cwd: string) =>
  invoke<GitWorktreeInfo[]>("/git/worktrees", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitCreateWorktree = (
  cwd: string,
  worktreePath: string,
  branch: string,
  baseBranch: string
) =>
  invoke<{ path: string; branch: string; base: string }>(
    "/git/worktrees/create",
    {
      args: { cwd, worktreePath, branch, baseBranch },
      method: "POST",
      body: { cwd, worktreePath, branch, baseBranch },
    }
  )

export const gitRemoveWorktree = (
  cwd: string,
  worktreePath: string,
  opts: { force?: boolean } = {}
) =>
  invoke<void>("/git/worktrees/remove", {
    args: { cwd, worktreePath, ...opts },
    method: "POST",
    body: { cwd, worktreePath, ...opts },
  })

export const gitPruneWorktrees = (cwd: string) =>
  invoke<void>("/git/worktrees/prune", {
    args: { cwd },
    method: "POST",
    body: { cwd },
  })

export const gitCaptureCheckpoint = (cwd: string, checkpointRef: string) =>
  invoke<{ ok: true }>("/git/checkpoints/capture", {
    args: { cwd, checkpointRef },
    method: "POST",
    body: { cwd, checkpointRef },
  })

export const gitDiffCheckpoints = (
  cwd: string,
  fromCheckpointRef: string,
  toCheckpointRef: string,
  opts: { fallbackFromToHead?: boolean; ignoreWhitespace?: boolean } = {}
) =>
  invoke<{ diff: string }>("/git/checkpoints/diff", {
    args: { cwd, fromCheckpointRef, toCheckpointRef, ...opts },
    method: "POST",
    body: { cwd, fromCheckpointRef, toCheckpointRef, ...opts },
  })
