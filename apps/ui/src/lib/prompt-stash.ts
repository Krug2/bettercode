export const MAX_PROMPT_STASH_ENTRIES = 50

export interface PromptStashEntry {
  id: string
  input: string
  timestamp: number
  threadId?: string | null
  projectPath?: string | null
}

export interface ResolvedPromptStashEntry {
  entry: PromptStashEntry
  index: number
  displayIndex: number
}

export function createPromptStashEntry(
  input: string,
  options: {
    id?: string
    threadId?: string | null
    projectPath?: string | null
    timestamp?: number
  } = {}
): PromptStashEntry {
  const timestamp = options.timestamp ?? Date.now()
  const id =
    options.id ??
    globalThis.crypto?.randomUUID?.() ??
    `stash-${timestamp}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    input,
    timestamp,
    threadId: options.threadId ?? null,
    projectPath: options.projectPath ?? null,
  }
}

export function pushPromptStashEntry(
  entries: readonly PromptStashEntry[],
  entry: PromptStashEntry,
  maxEntries = MAX_PROMPT_STASH_ENTRIES
): PromptStashEntry[] {
  return [...entries, entry].slice(-maxEntries)
}

export function removePromptStashEntry(
  entries: readonly PromptStashEntry[],
  index: number
): PromptStashEntry[] {
  return entries.filter((_, i) => i !== index)
}

export function resolvePromptStashEntry(
  entries: readonly PromptStashEntry[],
  selector?: string | null
): ResolvedPromptStashEntry | null {
  if (entries.length === 0) return null
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .map((item, displayIndex) => ({ ...item, displayIndex: displayIndex + 1 }))

  const query = selector?.trim()
  if (!query) return ordered[0] ?? null

  const numeric = Number(query)
  if (Number.isInteger(numeric) && numeric >= 1) {
    return ordered[numeric - 1] ?? null
  }

  const normalized = query.toLowerCase()
  return (
    ordered.find(
      ({ entry }) =>
        entry.id.toLowerCase().startsWith(normalized) ||
        firstPromptStashLine(entry.input).toLowerCase().includes(normalized)
    ) ?? null
  )
}

export function buildPromptStashListOutput(
  entries: readonly PromptStashEntry[],
  now = Date.now()
): string {
  if (entries.length === 0) {
    return [
      "# Prompt Stash",
      "",
      "> No stashed prompts yet.",
      "",
      "Use `/stash <prompt>` to save a prompt, then `/stash-pop` to restore the latest one into the composer.",
    ].join("\n")
  }

  const rows = entries
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .map(({ entry }, displayIndex) => {
      const lineCount = countPromptStashLines(entry.input)
      return `| ${displayIndex + 1} | \`${escapeMarkdownTableCell(entry.id.slice(0, 8))}\` | ${escapeMarkdownTableCell(previewPromptStashInput(entry.input, 72))} | ${formatPromptStashRelativeTime(entry.timestamp, now)} | ${lineCount} |`
    })

  return [
    "# Prompt Stash",
    "",
    `${entries.length} prompt${entries.length > 1 ? "s" : ""} stashed, newest first.\n`,
    "| # | ID | Preview | Age | Lines |",
    "|:--|:---|:--------|:----|:------|",
    ...rows,
    "",
    "> Use `/stash-pop [#|id]` to restore and remove an entry, or `/stash-delete <#|id>` to remove one without restoring it.",
  ].join("\n")
}

export function previewPromptStashInput(input: string, maxLength = 80): string {
  const firstLine = firstPromptStashLine(input)
  if (firstLine.length <= maxLength) return firstLine
  return `${firstLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
}

export function countPromptStashLines(input: string): number {
  return Math.max(1, input.split("\n").length)
}

export function formatPromptStashRelativeTime(
  timestamp: number,
  now = Date.now()
): string {
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function firstPromptStashLine(input: string): string {
  return input.split("\n")[0]?.trim() || "(empty prompt)"
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}
