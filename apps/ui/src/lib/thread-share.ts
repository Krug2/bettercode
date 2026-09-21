import type { ChatMessage, ChatThread, ToolCall } from "@betterc0de/schema"
import { fingerprintClaudeTerminalTranscript } from "@/lib/claude-terminal-history"

const THREAD_SHARE_STORAGE_KEY = "betterc0de-thread-shares"
const MAX_SHARE_TRANSCRIPT_CHARS = 120_000
const MAX_SHARE_MESSAGE_CHARS = 8_000
const MAX_SHARE_TOOL_CALLS = 20
const MAX_SHARE_DIFFS = 40

export interface ThreadShareRecord {
  threadId: string
  title: string
  sharedAt: string
  messageCount: number
  transcriptFingerprint: string
}

export function buildThreadShareMarkdown(thread: ChatThread): string {
  const messages = thread.messages.filter(hasMessageContext)
  const blocks: string[] = []
  let omitted = 0
  let totalLength = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    const block = formatShareMessage(message, index + 1)
    const nextLength = totalLength + block.length + (blocks.length > 0 ? 2 : 0)
    if (blocks.length > 0 && nextLength > MAX_SHARE_TRANSCRIPT_CHARS * 0.82) {
      omitted = index + 1
      break
    }
    blocks.unshift(block)
    totalLength = nextLength
  }

  const header = [
    `# ${thread.title || "Untitled chat"}`,
    "",
    "BetterC0de session export",
    "",
    "| Field | Value |",
    "|:--|:--|",
    `| Thread | \`${thread.id}\` |`,
    `| Project | ${escapeTableCell(thread.projectName || "BetterC0de")} |`,
    `| Workspace | ${escapeTableCell(thread.projectPath || thread.worktreePath || "not set")} |`,
    `| Messages | ${messages.length} |`,
    `| Exported | ${new Date().toISOString()} |`,
    omitted > 0 ? `| Older messages omitted | ${omitted} |` : null,
    "",
    "## Transcript",
  ].filter((line): line is string => line !== null)

  return clip([...header, ...blocks].join("\n"), MAX_SHARE_TRANSCRIPT_CHARS)
}

export function markThreadShared(input: {
  threadId: string
  title: string
  messageCount: number
  transcript: string
  sharedAt?: string
}): ThreadShareRecord {
  const record: ThreadShareRecord = {
    threadId: input.threadId,
    title: input.title,
    sharedAt: input.sharedAt ?? new Date().toISOString(),
    messageCount: input.messageCount,
    transcriptFingerprint: fingerprintClaudeTerminalTranscript(
      input.transcript
    ),
  }
  if (typeof localStorage !== "undefined") {
    const records = loadThreadShareRecords()
    records[input.threadId] = record
    localStorage.setItem(THREAD_SHARE_STORAGE_KEY, JSON.stringify(records))
  }
  return record
}

export function clearThreadShare(threadId: string): ThreadShareRecord | null {
  if (typeof localStorage === "undefined") return null
  const records = loadThreadShareRecords()
  const previous = records[threadId] ?? null
  delete records[threadId]
  localStorage.setItem(THREAD_SHARE_STORAGE_KEY, JSON.stringify(records))
  return previous
}

export function getThreadShare(threadId: string): ThreadShareRecord | null {
  if (typeof localStorage === "undefined") return null
  return loadThreadShareRecords()[threadId] ?? null
}

export function loadThreadShareRecords(): Record<string, ThreadShareRecord> {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(THREAD_SHARE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, ThreadShareRecord>
  } catch {
    return {}
  }
}

function hasMessageContext(message: ChatMessage): boolean {
  return (
    message.content.trim().length > 0 ||
    Boolean(message.reasoning?.trim()) ||
    Boolean(message.toolCalls?.length) ||
    Boolean(message.diffs?.length) ||
    Boolean(message.questions?.length) ||
    Boolean(message.answeredQuestions?.length)
  )
}

function formatShareMessage(message: ChatMessage, ordinal: number): string {
  const lines = [
    `### ${ordinal}. ${roleLabel(message.role)}${formatTimestamp(message.createdAt)}`,
  ]
  if (message.modelId) lines.push(`Model: \`${message.modelId}\``)
  if (message.content.trim()) {
    lines.push("", clip(message.content.trim(), MAX_SHARE_MESSAGE_CHARS))
  }
  if (message.reasoning?.trim()) {
    lines.push(
      "",
      "<details>",
      "<summary>Reasoning</summary>",
      "",
      clip(message.reasoning.trim(), MAX_SHARE_MESSAGE_CHARS),
      "",
      "</details>"
    )
  }
  const toolLines = formatShareToolCalls(message.toolCalls)
  if (toolLines.length > 0) lines.push("", "**Tool calls**", "", ...toolLines)
  if (message.diffs?.length) {
    const diffs = message.diffs
      .slice(0, MAX_SHARE_DIFFS)
      .map(
        (diff) => `- \`${diff.path}\` (+${diff.additions}/-${diff.deletions})`
      )
    if (message.diffs.length > MAX_SHARE_DIFFS) {
      diffs.push(`- ...${message.diffs.length - MAX_SHARE_DIFFS} more diff(s)`)
    }
    lines.push("", "**File changes**", "", ...diffs)
  }
  if (message.answeredQuestions?.length) {
    lines.push(
      "",
      "**Answered questions**",
      "",
      ...message.answeredQuestions.map(
        (item) =>
          `- Q: ${compactInline(item.question, 240)} | A: ${compactInline(item.answer, 240)}`
      )
    )
  }
  return lines.join("\n")
}

function formatShareToolCalls(
  toolCalls: readonly ToolCall[] | undefined
): string[] {
  if (!toolCalls?.length) return []
  const lines = toolCalls.slice(0, MAX_SHARE_TOOL_CALLS).map((tool) => {
    const parts = [`- \`${tool.name || "tool"}\``, tool.state]
    if (tool.input !== undefined)
      parts.push(`input: ${compactUnknown(tool.input, 360)}`)
    if (tool.outputPreview)
      parts.push(`output: ${compactInline(tool.outputPreview, 420)}`)
    else if (typeof tool.output === "string") {
      parts.push(`output: ${compactInline(tool.output, 420)}`)
    }
    if (tool.error) parts.push(`error: ${compactInline(tool.error, 320)}`)
    return parts.join(" | ")
  })
  if (toolCalls.length > MAX_SHARE_TOOL_CALLS) {
    lines.push(
      `- ...${toolCalls.length - MAX_SHARE_TOOL_CALLS} more tool call(s)`
    )
  }
  return lines
}

function compactUnknown(value: unknown, limit: number): string {
  if (typeof value === "string") return compactInline(value, limit)
  try {
    return compactInline(JSON.stringify(value), limit)
  } catch {
    return compactInline(String(value), limit)
  }
}

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "assistant") return "Assistant"
  if (role === "system") return "System"
  return "User"
}

function formatTimestamp(value: string): string {
  const trimmed = value.trim()
  return trimmed ? ` (${trimmed})` : ""
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function compactInline(value: string, limit: number): string {
  return clip(value.replace(/\s+/g, " ").trim(), limit)
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 24)).trimEnd()}\n[...truncated...]`
}
