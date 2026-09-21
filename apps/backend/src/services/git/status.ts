/**
 * Repository status with a short-lived cache, porcelain v2 parsing and
 * branch listing.
 */

import { type GitStatus } from "@betterc0de/schema"
import fs from "node:fs"
import path from "node:path"
import { gitRun } from "./process"

const STATUS_CACHE_TTL_MS = 1_000

const STATUS_CACHE_CAPACITY = 2_048

// The wire shape lives in @betterc0de/schema (GitStatus) so the renderer's
// git panel and this service cannot drift apart silently.
type GitStatusResult = GitStatus

const statusCache = new Map<
  string,
  {
    checkedAt: number
    promise: Promise<GitStatusResult>
  }
>()

async function statusCacheKey(cwd: string): Promise<string> {
  const resolved = path.resolve(cwd)
  try {
    return await fs.promises.realpath(resolved)
  } catch {
    return resolved
  }
}

function trimStatusCache(): void {
  while (statusCache.size > STATUS_CACHE_CAPACITY) {
    const first = statusCache.keys().next().value
    if (!first) break
    statusCache.delete(first)
  }
}

export async function invalidateStatusCache(
  cwd?: string | null
): Promise<void> {
  if (!cwd) {
    statusCache.clear()
    return
  }
  statusCache.delete(await statusCacheKey(cwd))
}

export async function invalidateStatusCaches(
  ...cwds: Array<string | null | undefined>
): Promise<void> {
  await Promise.all(
    Array.from(new Set(cwds.filter((cwd): cwd is string => Boolean(cwd)))).map(
      (cwd) => invalidateStatusCache(cwd)
    )
  )
}

async function readStatusUncached(cwd: string): Promise<GitStatusResult> {
  // Porcelain v2 with `-b` reports branch, upstream and ahead/behind in the
  // same output, so one git process replaces the three (status + rev-list +
  // rev-parse) this used to spawn per status poll.
  // `-z` because without it git C-quotes any path with a non-ASCII byte
  // (`"\303\274 \303\244.txt"`), a tab, or a quote — and this parser would
  // then hand the renderer the quoted form. NUL-terminated records carry
  // every path verbatim.
  const { stdout } = await gitRun(cwd, [
    "status",
    "--porcelain=v2",
    "-b",
    "-z",
    "--untracked-files=all",
  ])
  return parsePorcelainV2Status(stdout)
}

/**
 * Parse `git status --porcelain=v2 -b -z`. Exported for tests.
 *
 * Records are NUL-terminated. Header records: `# branch.head <name>`
 * (`(detached)` when not on a branch), `# branch.upstream <ref>` and
 * `# branch.ab +<ahead> -<behind>` (both only when an upstream is
 * configured). Entry records start with `1` (ordinary change), `2`
 * (rename/copy — the path ends the record and the ORIGINAL path follows as
 * a record of its own, where the non-`-z` form used a tab), `u` (unmerged),
 * `?` (untracked) or `!` (ignored). The XY column uses `.` for "unchanged"
 * where v1 used a space. Paths are never quoted in `-z` mode.
 */
export function parsePorcelainV2Status(stdout: string): GitStatusResult {
  let branch = ""
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const staged: string[] = []
  const modified: string[] = []
  const untracked: string[] = []

  const classify = (xy: string, filePath: string) => {
    const x = xy[0]
    const y = xy[1]
    if (x && x !== "." && x !== "?") staged.push(filePath)
    if (y && y !== "." && y !== "?") modified.push(filePath)
  }

  const records = stdout.split("\0")
  for (let index = 0; index < records.length; index += 1) {
    const line = records[index]!
    if (!line) continue
    if (line.startsWith("# ")) {
      const [key, ...rest] = line.slice(2).split(" ")
      const value = rest.join(" ")
      if (key === "branch.head") {
        // Keep the v1 wording for detached HEAD; the renderer displays it.
        branch = value === "(detached)" ? "HEAD (no branch)" : value
      } else if (key === "branch.upstream") {
        upstream = value || null
      } else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value)
        if (match) {
          ahead = Number.parseInt(match[1]!, 10) || 0
          behind = Number.parseInt(match[2]!, 10) || 0
        }
      }
      continue
    }
    const kind = line[0]
    if (kind === "?") {
      untracked.push(line.slice(2))
      continue
    }
    if (kind === "!") continue
    if (kind === "1") {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const fields = line.split(" ")
      const xy = fields[1] ?? ""
      const filePath = fields.slice(8).join(" ")
      if (filePath) classify(xy, filePath)
      continue
    }
    if (kind === "2") {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>NUL<origPath>NUL
      // The original path is its own NUL-terminated record; consume it so
      // it is not read as an entry of unknown kind.
      const fields = line.split(" ")
      const xy = fields[1] ?? ""
      const filePath = fields.slice(9).join(" ")
      index += 1
      if (filePath) classify(xy, filePath)
      continue
    }
    if (kind === "u") {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const fields = line.split(" ")
      const xy = fields[1] ?? ""
      const filePath = fields.slice(10).join(" ")
      if (filePath) classify(xy, filePath)
    }
  }

  const is_clean =
    staged.length === 0 && modified.length === 0 && untracked.length === 0
  return { branch, is_clean, staged, modified, untracked, ahead, behind, upstream }
}

export async function status(cwd: string): Promise<GitStatusResult> {
  const key = await statusCacheKey(cwd)
  const now = Date.now()
  const cached = statusCache.get(key)
  if (cached && now - cached.checkedAt < STATUS_CACHE_TTL_MS) {
    return cached.promise
  }

  const promise = readStatusUncached(cwd).catch((error) => {
    if (statusCache.get(key)?.promise === promise) {
      statusCache.delete(key)
    }
    throw error
  })
  statusCache.set(key, { checkedAt: now, promise })
  trimStatusCache()
  return promise
}

/** Resolve `@{upstream}` (e.g. `origin/main`) for the current HEAD, or
 *  return null when no tracking branch is configured. UI uses this to
 *  decide whether the Push button should be a "publish branch" call vs a
 *  regular fast-forward push. */
export async function listBranches(cwd: string) {
  const { stdout } = await gitRun(cwd, [
    "branch",
    "--list",
    "--format=%(refname:short)",
  ])
  const branches = stdout
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean)
  const headRes = await gitRun(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  return { branches, current: headRes.stdout.trim() }
}

export async function isRepo(cwd: string) {
  try {
    await gitRun(cwd, ["rev-parse", "--is-inside-work-tree"])
    return { is_repo: true }
  } catch {
    return { is_repo: false }
  }
}

/** Shell out to `git rev-parse HEAD`. Returns the SHA or null if not a repo. */
export async function headSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await gitRun(cwd, ["rev-parse", "HEAD"])
    const sha = stdout.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}
