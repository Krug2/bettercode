export const MAX_PROMPT_HISTORY_ENTRIES = 50

export interface PromptHistoryEntry {
  id: string
  input: string
  timestamp: number
  threadId?: string | null
  projectPath?: string | null
}

export interface ResolvedPromptHistoryEntry {
  entry: PromptHistoryEntry
  index: number
  displayIndex: number
}

export function createPromptHistoryEntry(
  input: string,
  options: {
    id?: string
    threadId?: string | null
    projectPath?: string | null
    timestamp?: number
  } = {}
): PromptHistoryEntry {
  const timestamp = options.timestamp ?? Date.now()
  const id =
    options.id ??
    globalThis.crypto?.randomUUID?.() ??
    `history-${timestamp}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    input,
    timestamp,
    threadId: options.threadId ?? null,
    projectPath: options.projectPath ?? null,
  }
}

export function pushPromptHistoryEntry(
  entries: readonly PromptHistoryEntry[],
  entry: PromptHistoryEntry,
  maxEntries = MAX_PROMPT_HISTORY_ENTRIES
): PromptHistoryEntry[] {
  if (isDuplicatePromptHistoryEntry(entries.at(-1), entry)) {
    return [...entries]
  }
  return [...entries, entry].slice(-maxEntries)
}

export function isDuplicatePromptHistoryEntry(
  previous: PromptHistoryEntry | undefined,
  next: PromptHistoryEntry
): boolean {
  return Boolean(previous && previous.input === next.input)
}

export function resolvePromptHistoryEntry(
  entries: readonly PromptHistoryEntry[],
  selector?: string | null
): ResolvedPromptHistoryEntry | null {
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
        firstPromptHistoryLine(entry.input).toLowerCase().includes(normalized)
    ) ?? null
  )
}

export function promptHistoryInputForIndex(
  entries: readonly PromptHistoryEntry[],
  index: number,
  currentDraft: string
): string | null {
  if (index === 0) return currentDraft
  if (index > 0) return null
  const entry = entries.at(index)
  return entry?.input ?? null
}

export function buildPromptHistoryListOutput(
  entries: readonly PromptHistoryEntry[],
  now = Date.now()
): string {
  if (entries.length === 0) {
    return [
      "# Prompt History",
      "",
      "> No prompt history has been recorded yet.",
      "",
      "Submitted prompts are recorded automatically. Use Arrow Up/Down in the composer to navigate history, or `/history-use [#|id]` to restore one.",
    ].join("\n")
  }

  const rows = entries
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .map(({ entry }, displayIndex) => {
      const lineCount = countPromptHistoryLines(entry.input)
      return `| ${displayIndex + 1} | \`${escapeMarkdownTableCell(entry.id.slice(0, 8))}\` | ${escapeMarkdownTableCell(previewPromptHistoryInput(entry.input, 72))} | ${formatPromptHistoryRelativeTime(entry.timestamp, now)} | ${lineCount} |`
    })

  return [
    "# Prompt History",
    "",
    `${entries.length} prompt${entries.length > 1 ? "s" : ""} recorded, newest first.\n`,
    "| # | ID | Preview | Age | Lines |",
    "|:--|:---|:--------|:----|:------|",
    ...rows,
    "",
    "> Use `/history-use [#|id]` to restore a prompt without removing it. Arrow Up/Down also navigates this history from the composer edges.",
  ].join("\n")
}

export function previewPromptHistoryInput(input: string, maxLength = 80): string {
  const firstLine = firstPromptHistoryLine(input)
  if (firstLine.length <= maxLength) return firstLine
  return `${firstLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
}

export function countPromptHistoryLines(input: string): number {
  return Math.max(1, input.split("\n").length)
}

export function formatPromptHistoryRelativeTime(
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

function firstPromptHistoryLine(input: string): string {
  return input.split("\n")[0]?.trim() || "(empty prompt)"
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}
