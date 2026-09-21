import {
  workspaceContextArtifactResultSchema,
  type WorkspaceContextArtifactResult,
  type WorkspaceContextSource,
  asRecord,
} from "@betterc0de/schema"
import type { AppState } from "../appState"
import { resolveAppEffectiveRules } from "./effective-rules"

const PROVIDER_HISTORY_DISPLAY_LIMIT = 80
const CHILD_DETAIL_LIMIT = 3

export async function buildWorkspaceContextArtifact(
  state: Pick<AppState, "config" | "settings" | "threads">,
  input: {
    readonly workspaceRoot: string
    readonly targetPath: string
    readonly threadId?: string
    readonly pendingMessageCharacters?: number
    readonly pendingAttachments?: readonly {
      readonly id: string
      readonly name: string
      readonly mediaType: string | null
      readonly sizeBytes: number | null
    }[]
  }
): Promise<WorkspaceContextArtifactResult> {
  const rules = await resolveAppEffectiveRules(state, {
    workspaceRoot: input.workspaceRoot,
    targetPath: input.targetPath,
  })
  const messages = input.threadId
    ? (state.threads.listMessages(input.threadId, {
        limit: 1_000,
      }) as Record<string, unknown>[])
    : []
  const boundaryIndex = lastCompactionBoundary(messages)
  const activeMessages =
    boundaryIndex >= 0 ? messages.slice(boundaryIndex) : messages
  const visibleMessages = activeMessages.slice(-PROVIDER_HISTORY_DISPLAY_LIMIT)
  const excludedMessageCount =
    Math.max(0, boundaryIndex) +
    Math.max(0, activeMessages.length - visibleMessages.length)
  const boundary = boundaryIndex >= 0 ? messages[boundaryIndex] : undefined
  const generation = nonnegativeInteger(boundary?.compactionGeneration) ?? 0
  const boundaryMessageId = stringValue(boundary?.id)

  const providerHistory = input.threadId
    ? state.threads.buildProviderHistory(input.threadId)
    : []
  const historyCharacters =
    providerHistory.length > 0 ? safeJsonLength(providerHistory) : 0
  const sources: WorkspaceContextSource[] = []

  const appliedRules = rules.sources.filter((source) => source.applied)
  const systemInstructionCharacters =
    latestSystemInstructionCharacters(activeMessages)
  const representedSystemCharacters =
    systemInstructionCharacters ?? rules.content.length
  sources.push({
    id: "context:system",
    parentId: null,
    kind: "system",
    label: "Turn system instruction",
    detail:
      systemInstructionCharacters === undefined
        ? "Current backend-resolved contribution"
        : "Captured dispatch size",
    sourcePath: null,
    estimatedTokens: estimateTokens(representedSystemCharacters),
    characters: representedSystemCharacters,
    included: representedSystemCharacters > 0,
    reason:
      systemInstructionCharacters === undefined
        ? appliedRules.length > 0
          ? "No prior dispatch snapshot is available; this count covers the current resolved rule contribution only."
          : "No prior dispatched system-instruction snapshot is available."
        : "Size captured from the actual dispatch; hidden instruction contents are intentionally not exposed.",
    truncated: false,
  })

  sources.push({
    id: "context:rules",
    parentId: "context:system",
    kind: "rules",
    label: "Effective rules",
    detail: rules.explanation.summary,
    sourcePath: null,
    estimatedTokens: estimateTokens(rules.content.length),
    characters: rules.content.length,
    included: appliedRules.length > 0,
    reason:
      appliedRules.length > 0
        ? "Merged into the turn system instruction."
        : "No applicable rule source was found.",
    truncated: appliedRules.some((source) => source.truncated),
  })
  for (const source of rules.sources) {
    sources.push({
      id: `context:rule:${source.id}`,
      parentId: "context:rules",
      kind: "rule",
      label: source.sourcePath,
      detail: `${source.scope} · precedence ${source.precedence}`,
      sourcePath: source.sourcePath,
      estimatedTokens: estimateTokens(source.content.length),
      characters: source.content.length,
      included: source.applied,
      reason: source.reason,
      truncated: source.truncated,
    })
  }

  sources.push({
    id: "context:history",
    parentId: null,
    kind: "history",
    label: "Conversation history",
    detail: `${providerHistory.length} normalized provider entr${providerHistory.length === 1 ? "y" : "ies"}`,
    sourcePath: null,
    estimatedTokens: estimateTokens(historyCharacters),
    characters: historyCharacters,
    included: providerHistory.length > 0,
    reason:
      providerHistory.length > 0
        ? "Normalized, compacted, and bounded provider history."
        : "No prior user or assistant history is included.",
    truncated: excludedMessageCount > 0,
  })

  for (const [index, message] of visibleMessages.entries()) {
    appendMessageSources(sources, message, index)
  }

  appendPendingComposerSources(sources, {
    messageCharacters: input.pendingMessageCharacters ?? 0,
    attachments: input.pendingAttachments ?? [],
  })

  if (boundaryMessageId || excludedMessageCount > 0) {
    sources.push({
      id: "context:compaction",
      parentId: null,
      kind: "compaction",
      label: "Compaction boundary",
      detail: boundaryMessageId
        ? `Generation ${generation} at ${boundaryMessageId}`
        : "Provider history window",
      sourcePath: null,
      estimatedTokens: 0,
      characters: 0,
      included: true,
      reason: `${excludedMessageCount} older message${excludedMessageCount === 1 ? "" : "s"} excluded from active context.`,
      truncated: excludedMessageCount > 0,
    })
  }

  const usage = latestUsage(messages)
  const estimatedTokens = sources
    .filter((source) => source.parentId === null && source.included)
    .reduce((total, source) => total + source.estimatedTokens, 0)
  const maxTokens = positiveInteger(usage?.maxTokens)
  const usedTokens =
    nonnegativeInteger(usage?.usedTokens) ??
    nonnegativeInteger(usage?.totalTokens) ??
    estimatedTokens

  return workspaceContextArtifactResultSchema.parse({
    workspaceRoot: input.workspaceRoot,
    targetPath: rules.targetPath,
    threadId: input.threadId ?? null,
    usedTokens,
    estimatedTokens,
    maxTokens: maxTokens ?? null,
    remainingTokens:
      maxTokens === undefined ? null : Math.max(0, maxTokens - usedTokens),
    compactsAutomatically:
      typeof usage?.compactsAutomatically === "boolean"
        ? usage.compactsAutomatically
        : null,
    compaction: {
      generation,
      boundaryMessageId: boundaryMessageId ?? null,
      excludedMessageCount,
    },
    sources,
  })
}

function appendPendingComposerSources(
  sources: WorkspaceContextSource[],
  input: {
    readonly messageCharacters: number
    readonly attachments: readonly {
      readonly id: string
      readonly name: string
      readonly mediaType: string | null
      readonly sizeBytes: number | null
    }[]
  }
): void {
  const included =
    input.messageCharacters > 0 || input.attachments.length > 0
  sources.push({
    id: "context:pending",
    parentId: null,
    kind: "prompt",
    label: "Pending composer input",
    detail: `${input.messageCharacters} draft character${input.messageCharacters === 1 ? "" : "s"} · ${input.attachments.length} attachment${input.attachments.length === 1 ? "" : "s"}`,
    sourcePath: null,
    estimatedTokens: estimateTokens(input.messageCharacters),
    characters: input.messageCharacters,
    included,
    reason: included
      ? "Queued for the next turn but not yet present in persisted provider history."
      : "The composer has no unsent text or attachments.",
    truncated: false,
  })

  for (const [index, attachment] of input.attachments.entries()) {
    sources.push({
      id: `context:pending:attachment:${index}`,
      parentId: "context:pending",
      kind: "attachment",
      label: attachment.name,
      detail: [
        attachment.mediaType,
        attachment.sizeBytes === null
          ? null
          : `${attachment.sizeBytes.toLocaleString("en-US")} bytes`,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · "),
      sourcePath: null,
      estimatedTokens: 0,
      characters: 0,
      included: true,
      reason:
        "Attachment content is queued for provider-specific encoding; its token cost is unavailable until dispatch.",
      truncated: false,
    })
  }
}

function appendMessageSources(
  sources: WorkspaceContextSource[],
  message: Record<string, unknown>,
  index: number
): void {
  const id = stringValue(message.id) ?? `message-${index}`
  const nodeId = `context:message:${id}`
  const role = stringValue(message.role) ?? "message"
  const content = stringValue(message.content) ?? ""
  const reasoning = stringValue(message.reasoning) ?? ""
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : []
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : []
  const characters =
    content.length + reasoning.length + safeJsonLength(toolCalls)

  sources.push({
    id: nodeId,
    parentId: "context:history",
    kind: "message",
    label: `${titleCase(role)} message`,
    detail: stringValue(message.createdAt) ?? null,
    sourcePath: null,
    estimatedTokens: estimateTokens(characters),
    characters,
    included: role === "user" || role === "assistant",
    reason:
      role === "user" || role === "assistant"
        ? "Eligible for normalized provider history within active limits."
        : "The provider-history normalizer excludes this role.",
    truncated: message.transcriptTruncated === true,
  })

  for (const [toolIndex, rawTool] of toolCalls
    .slice(0, CHILD_DETAIL_LIMIT)
    .entries()) {
    const tool = asRecord(rawTool)
    const toolId = stringValue(tool.id) ?? String(toolIndex)
    const toolCharacters = safeJsonLength({
      input: tool.input,
      output: tool.output ?? tool.outputPreview,
      error: tool.error,
    })
    sources.push({
      id: `${nodeId}:tool:${toolId}`,
      parentId: nodeId,
      kind: "tool",
      label: stringValue(tool.name) ?? "Tool call",
      detail: stringValue(tool.state) ?? null,
      sourcePath: toolPath(tool),
      estimatedTokens: estimateTokens(toolCharacters),
      characters: toolCharacters,
      included: true,
      reason:
        "Validated tool input and bounded result are normalized into history.",
      truncated: tool.outputTruncated === true,
    })
  }

  for (const [attachmentIndex, rawAttachment] of attachments
    .slice(0, CHILD_DETAIL_LIMIT)
    .entries()) {
    const attachment = asRecord(rawAttachment)
    sources.push({
      id: `${nodeId}:attachment:${stringValue(attachment.id) ?? attachmentIndex}`,
      parentId: nodeId,
      kind: "attachment",
      label:
        stringValue(attachment.name) ??
        stringValue(attachment.filename) ??
        "Attachment",
      detail: stringValue(attachment.type) ?? null,
      sourcePath:
        stringValue(attachment.path) ??
        stringValue(attachment.filePath) ??
        null,
      estimatedTokens: 0,
      characters: 0,
      included: false,
      reason:
        "Stored attachment metadata is inspectable; binary content is not replayed as text history.",
      truncated: false,
    })
  }
}

function lastCompactionBoundary(messages: readonly Record<string, unknown>[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.compactedContext === true) return index
  }
  return -1
}

function latestUsage(messages: readonly Record<string, unknown>[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = asRecord(messages[index]?.usage)
    if (Object.keys(usage).length > 0) return usage
  }
  return null
}

function latestSystemInstructionCharacters(
  messages: readonly Record<string, unknown>[]
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index]?.systemInstructionCharacters
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return value
    }
  }
  return undefined
}

function toolPath(tool: Record<string, unknown>): string | null {
  const input = asRecord(tool.input)
  return (
    stringValue(input.path) ??
    stringValue(input.file_path) ??
    stringValue(input.filePath) ??
    null
  )
}

function estimateTokens(characters: number): number {
  return characters > 0 ? Math.ceil(characters / 4) : 0
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const normalized = nonnegativeInteger(value)
  return normalized !== undefined && normalized > 0 ? normalized : undefined
}

function titleCase(value: string): string {
  return value.length > 0
    ? `${value[0]?.toUpperCase()}${value.slice(1)}`
    : value
}
