import type { ChatMessage, ModelSelection, ToolCall } from "@betterc0de/schema"

const MAX_PROMPT_CHARS = 12_000
const MAX_COMPACTION_MESSAGES = 90
const MAX_COMPACTION_TRANSCRIPT_CHARS = 60_000
const MAX_COMPACTION_MESSAGE_CHARS = 2_400
const MAX_COMPACTION_TOOL_CALLS_PER_MESSAGE = 12
const MAX_COMPACTION_DIFFS_PER_MESSAGE = 16

export interface ClaudeTerminalHistoryInput {
  threadTitle?: string | null
  projectPath?: string | null
  messages: readonly ChatMessage[]
}

export interface ClaudeTerminalSummaryPromptInput {
  threadTitle?: string | null
  projectPath?: string | null
  summary: string
}

export interface ClaudeTerminalLaunchFingerprintInput {
  historyFingerprint: string
  selectedModel?: string | null
  thinkingMode?: string | null
  permissionLevel?: string | null
  compactionModelSelection?: ModelSelection | null
}

export interface ClaudeTerminalCompactionFingerprintInput {
  historyFingerprint: string
  modelSelection?: ModelSelection | null
}

export function fingerprintClaudeTerminalTranscript(
  transcript: string | null | undefined
): string {
  const value = transcript?.trim() ?? ""
  if (!value) return "empty"
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `v1:${value.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function fingerprintClaudeTerminalLaunch(
  input: ClaudeTerminalLaunchFingerprintInput
): string {
  return fingerprintStablePayload("claude-terminal-launch", {
    historyFingerprint: input.historyFingerprint,
    selectedModel: input.selectedModel?.trim() || null,
    thinkingMode: input.thinkingMode?.trim() || null,
    permissionLevel: input.permissionLevel?.trim() || null,
    compactionModelSelection: stableModelSelection(
      input.compactionModelSelection
    ),
  })
}

export function fingerprintClaudeTerminalCompaction(
  input: ClaudeTerminalCompactionFingerprintInput
): string {
  return fingerprintStablePayload("claude-terminal-compaction", {
    historyFingerprint: input.historyFingerprint,
    modelSelection: stableModelSelection(input.modelSelection),
  })
}

export function buildClaudeTerminalCompactionTranscript({
  threadTitle,
  projectPath,
  messages,
}: ClaudeTerminalHistoryInput): string | null {
  return buildClaudeTerminalTranscript({
    threadTitle,
    projectPath,
    messages,
    maxMessages: MAX_COMPACTION_MESSAGES,
    maxTranscriptChars: MAX_COMPACTION_TRANSCRIPT_CHARS,
    maxMessageChars: MAX_COMPACTION_MESSAGE_CHARS,
    maxToolCallsPerMessage: MAX_COMPACTION_TOOL_CALLS_PER_MESSAGE,
    maxDiffsPerMessage: MAX_COMPACTION_DIFFS_PER_MESSAGE,
  })
}

function buildClaudeTerminalTranscript({
  threadTitle,
  projectPath,
  messages,
  maxMessages,
  maxTranscriptChars,
  maxMessageChars,
  maxToolCallsPerMessage,
  maxDiffsPerMessage,
}: ClaudeTerminalHistoryInput & {
  maxMessages: number
  maxTranscriptChars: number
  maxMessageChars: number
  maxToolCallsPerMessage: number
  maxDiffsPerMessage: number
}): string | null {
  const entries = messages
    .map((message, index) => ({ message, ordinal: index + 1 }))
    .filter(({ message }) => hasMessageContext(message))

  if (entries.length === 0) return null

  const candidates = entries.slice(-maxMessages)
  const blocks: string[] = []
  let omitted = entries.length - candidates.length
  let bodyLength = 0

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const block = formatMessageBlock(candidates[index]!, {
      maxMessageChars,
      maxToolCallsPerMessage,
      maxDiffsPerMessage,
    })
    const nextLength = bodyLength + block.length + (blocks.length > 0 ? 2 : 0)
    if (blocks.length > 0 && nextLength > maxTranscriptChars * 0.82) {
      omitted += index + 1
      break
    }
    blocks.unshift(block)
    bodyLength = nextLength
  }

  const header = [
    "Thread metadata:",
    `- Title: ${compactInline(threadTitle || "Untitled thread", 160)}`,
    projectPath
      ? `- Workspace: ${compactInline(projectPath, 220)}`
      : "- Workspace: not set",
    `- Messages compacted: ${entries.length}`,
    omitted > 0 ? `- Older messages omitted: ${omitted}` : null,
    "",
    "Compact transcript:",
  ].filter((line): line is string => line !== null)

  return clip([...header, ...blocks].join("\n"), maxTranscriptChars)
}

export function buildClaudeTerminalSummaryPrompt({
  threadTitle,
  projectPath,
  summary,
}: ClaudeTerminalSummaryPromptInput): string | null {
  const compactSummary = summary.trim()
  if (!compactSummary) return null
  return clip(
    [
      "You are continuing a BetterC0de UI chat inside Claude Terminal.",
      "",
      "Thread metadata:",
      `- Title: ${compactInline(threadTitle || "Untitled thread", 160)}`,
      projectPath
        ? `- Workspace: ${compactInline(projectPath, 220)}`
        : "- Workspace: not set",
      "",
      "Instructions:",
      "- Treat this model-generated thread summary as background context only.",
      "- Do not repeat or mention this injected context unless the user asks.",
      "- Continue from the user's next terminal input.",
      "- If the summary mentions completed file edits or tool results, assume they may already exist on disk and verify before changing them.",
      "",
      "Model-compacted thread summary:",
      compactSummary,
    ].join("\n"),
    MAX_PROMPT_CHARS
  )
}

function hasMessageContext(message: ChatMessage): boolean {
  return (
    message.content.trim().length > 0 ||
    Boolean(message.toolCalls?.length) ||
    Boolean(message.diffs?.length) ||
    Boolean(message.questions?.length) ||
    Boolean(message.answeredQuestions?.length)
  )
}

function formatMessageBlock(
  {
    message,
    ordinal,
  }: {
    message: ChatMessage
    ordinal: number
  },
  options: {
    maxMessageChars: number
    maxToolCallsPerMessage: number
    maxDiffsPerMessage: number
  }
): string {
  const lines = [
    `### ${ordinal}. ${roleLabel(message.role)}${formatTimestamp(message.createdAt)}`,
  ]
  const content = normalizeBlock(message.content)
  if (content) {
    lines.push(clip(content, options.maxMessageChars))
  }

  const toolLines = formatToolCalls(
    message.toolCalls,
    options.maxToolCallsPerMessage
  )
  if (toolLines.length > 0) {
    lines.push("Tool calls:")
    lines.push(...toolLines)
  }

  if (message.diffs?.length) {
    const diffs = message.diffs
      .slice(0, options.maxDiffsPerMessage)
      .map((diff) => `- ${diff.path} (+${diff.additions}/-${diff.deletions})`)
    if (message.diffs.length > options.maxDiffsPerMessage) {
      diffs.push(
        `- ...${message.diffs.length - options.maxDiffsPerMessage} more diff(s) omitted`
      )
    }
    lines.push("File diffs:")
    lines.push(...diffs)
  }

  if (message.answeredQuestions?.length) {
    lines.push("Answered questions:")
    lines.push(
      ...message.answeredQuestions
        .slice(0, 4)
        .map(
          (item) =>
            `- Q: ${compactInline(item.question, 180)} | A: ${compactInline(
              item.answer,
              180
            )}`
        )
    )
  }

  if (message.questions?.length) {
    lines.push("Open questions:")
    lines.push(
      ...message.questions
        .filter((question) => !question.answer)
        .slice(0, 4)
        .map((question) => `- ${compactInline(question.text, 240)}`)
    )
  }

  return lines.join("\n")
}

function formatToolCalls(
  toolCalls: readonly ToolCall[] | undefined,
  maxToolCalls: number
): string[] {
  if (!toolCalls?.length) return []
  const lines = toolCalls.slice(0, maxToolCalls).map((call) => {
    const pieces = [`- ${compactInline(call.name || "tool", 100)}`, call.state]
    const input = compactUnknown(call.input, 260)
    if (input) pieces.push(`input: ${input}`)
    const output = summarizeToolOutput(call)
    if (output) pieces.push(`output: ${output}`)
    if (call.error) pieces.push(`error: ${compactInline(call.error, 220)}`)
    return pieces.join(" | ")
  })
  if (toolCalls.length > maxToolCalls) {
    lines.push(
      `- ...${toolCalls.length - maxToolCalls} more tool call(s) omitted`
    )
  }
  return lines
}

function summarizeToolOutput(call: ToolCall): string | null {
  if (call.outputPreview) return compactInline(call.outputPreview, 360)
  if (typeof call.output === "string") return compactInline(call.output, 360)
  return null
}

function compactUnknown(value: unknown, limit: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return compactInline(value, limit)
  try {
    return compactInline(JSON.stringify(value), limit)
  } catch {
    return compactInline(String(value), limit)
  }
}

function fingerprintStablePayload(namespace: string, payload: unknown): string {
  return fingerprintClaudeTerminalTranscript(
    `${namespace}:${stableStringify(payload)}`
  )
}

function stableModelSelection(
  selection: ModelSelection | null | undefined
): Record<string, unknown> | null {
  if (!selection) return null
  return {
    instanceId: selection.instanceId.trim(),
    model: selection.model.trim(),
    options: [...(selection.options ?? [])]
      .map((option) => ({
        id: option.id,
        value: option.value,
      }))
      .sort((a, b) => {
        const byId = a.id.localeCompare(b.id)
        if (byId !== 0) return byId
        return stableStringify(a.value).localeCompare(stableStringify(b.value))
      }),
  }
}

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b)
  )
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

function roleLabel(role: ChatMessage["role"]): string {
  switch (role) {
    case "assistant":
      return "Assistant"
    case "system":
      return "System"
    case "user":
      return "User"
    case "tool":
      return "Tool"
  }
}

function formatTimestamp(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  return ` (${trimmed})`
}

function normalizeBlock(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function compactInline(value: string, limit: number): string {
  return clip(value.replace(/\s+/g, " ").trim(), limit)
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 24)).trimEnd()}\n[...truncated...]`
}
