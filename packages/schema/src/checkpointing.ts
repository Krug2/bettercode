import { z } from "zod"

export const CHECKPOINT_REFS_PREFIX = "refs/betterc0de/checkpoints"

export const turnDiffFileSummarySchema = z.object({
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})
export type TurnDiffFileSummary = z.infer<typeof turnDiffFileSummarySchema>

export function checkpointRefForThreadTurn(
  threadId: string,
  turnCount: number,
): string {
  if (!threadId.trim()) throw new Error("threadId is required")
  if (!Number.isSafeInteger(turnCount) || turnCount < 0) {
    throw new Error("turnCount must be a non-negative safe integer")
  }
  return `${CHECKPOINT_REFS_PREFIX}/${base64Url(threadId)}/turn/${turnCount}`
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []

  const summaries: TurnDiffFileSummary[] = []
  let current: MutableTurnDiffFileSummary | null = null
  let inHunk = false

  const flush = () => {
    if (!current?.path) return
    summaries.push({
      path: current.path,
      additions: current.additions,
      deletions: current.deletions,
    })
  }

  for (const line of normalized.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush()
      current = {
        path: parseDiffGitPath(line),
        additions: 0,
        deletions: 0,
      }
      inHunk = false
      continue
    }

    if (!current) continue

    if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length).trim()
      continue
    }

    if (line.startsWith("+++ ")) {
      const nextPath = parsePatchHeaderPath(line.slice("+++ ".length))
      if (nextPath) current.path = nextPath
      continue
    }

    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }

    if (!inHunk) continue
    if (line.startsWith("+")) {
      current.additions += 1
    } else if (line.startsWith("-")) {
      current.deletions += 1
    }
  }

  flush()
  return summaries.sort((left, right) => left.path.localeCompare(right.path))
}

interface MutableTurnDiffFileSummary {
  path: string
  additions: number
  deletions: number
}

function parseDiffGitPath(line: string): string {
  const body = line.slice("diff --git ".length).trim()
  const parts = splitDiffGitPaths(body)
  return stripDiffPathPrefix(parts[1] ?? parts[0] ?? "")
}

function splitDiffGitPaths(value: string): string[] {
  if (!value.includes('"')) {
    // Git leaves ordinary spaces unquoted. Binary/deleted files may have no
    // +++ header to repair a truncated path later. Match equal paths first,
    // including names that themselves contain " b/".
    const samePath = /^a\/(.+) b\/\1$/.exec(value)
    if (samePath) return [`a/${samePath[1]}`, `b/${samePath[1]}`]
    const boundary = value.indexOf(" b/")
    return boundary >= 0
      ? [value.slice(0, boundary), value.slice(boundary + 1)]
      : [value]
  }

  const out: string[] = []
  const re = /"((?:\\"|[^"])*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value)) !== null) {
    out.push((match[1] ?? match[2] ?? "").replace(/\\"/g, '"'))
  }
  return out
}

function parsePatchHeaderPath(value: string): string | null {
  const clean = value.trim()
  if (!clean || clean === "/dev/null") return null
  return stripDiffPathPrefix(clean)
}

function stripDiffPathPrefix(value: string): string {
  const clean = value.trim().replace(/^"|"$/g, "")
  if (clean.startsWith("a/") || clean.startsWith("b/")) return clean.slice(2)
  return clean
}

function base64Url(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  const bytes = utf8Bytes(value)
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const chunk = (a << 16) | (b << 8) | c
    out += alphabet[(chunk >> 18) & 63]
    out += alphabet[(chunk >> 12) & 63]
    if (i + 1 < bytes.length) out += alphabet[(chunk >> 6) & 63]
    if (i + 2 < bytes.length) out += alphabet[chunk & 63]
  }
  return out
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i += 1) {
    const codePoint = value.codePointAt(i) ?? 0
    if (codePoint > 0xffff) i += 1
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return bytes
}
