const TOKENS_PER_ESTIMATED_CHARACTER = 4
const DEFAULT_RESERVED_TOKENS = 20_000
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000
const MIN_COMPACTABLE_TOKENS = 2_000
const MAX_ESTIMATED_CHARACTERS = 64_000_000
const MAX_TOOL_CALLS_PER_MESSAGE = 128
const MAX_COMPACTION_MESSAGES = 90
const MAX_COMPACTION_TRANSCRIPT_CHARACTERS = 60_000
const MAX_COMPACTION_MESSAGE_CHARACTERS = 2_400
const MAX_COMPACTION_TOOL_CALLS_PER_MESSAGE = 12
const MAX_COMPACTION_DIFFS_PER_MESSAGE = 16

export type AutoCompactionDecisionReason =
  | "threshold-reached"
  | "disabled"
  | "provider-native"
  | "turn-active"
  | "context-window-unknown"
  | "invalid-budget"
  | "below-threshold"
  | "insufficient-history"
  | "preserve-budget"
  | "config-unavailable"

export interface AutoCompactionProjectSetting {
  readonly key: string
  readonly value: string
  readonly sourcePath?: string
}

export interface AutoCompactionConfig {
  readonly enabled: boolean
  readonly reservedTokens: number | null
  readonly preserveRecentTokens: number | null
  readonly tailTurns: number
  readonly sources: {
    readonly enabled: string | null
    readonly reservedTokens: string | null
    readonly preserveRecentTokens: string | null
    readonly tailTurns: string | null
  }
}

export interface AutoCompactionContextSnapshot {
  readonly estimatedTokens: number
  readonly completedTurns: number
  readonly compactionGeneration: number
  readonly boundaryCreatedAt: string | null
  readonly lastMessageId: string | null
}

export interface AutoCompactionDecisionInput {
  readonly config: AutoCompactionConfig
  readonly configAvailable?: boolean
  readonly turnActive?: boolean
  readonly compactsAutomatically?: boolean
  readonly usedTokens?: number | null
  readonly estimatedTokens: number
  readonly incomingTokens: number
  readonly maxTokens?: number | null
  readonly modelInputTokens?: number | null
  readonly modelOutputTokens?: number | null
  readonly completedTurns: number
  readonly compactionGeneration?: number
  readonly lastMessageId?: string | null
}

export interface AutoCompactionDecision {
  readonly shouldCompact: boolean
  readonly reason: AutoCompactionDecisionReason
  readonly enabled: boolean
  readonly compactsAutomatically: boolean
  readonly usedTokens: number
  readonly estimatedTokens: number
  readonly incomingTokens: number
  readonly projectedTokens: number
  readonly maxTokens: number | null
  readonly thresholdTokens: number | null
  readonly reservedTokens: number
  readonly preserveRecentTokens: number
  readonly tailTurns: number
  readonly completedTurns: number
  readonly compactableTokens: number
  readonly compactionGeneration: number
  readonly precondition: {
    readonly compactionGeneration: number
    readonly lastMessageId: string | null
  }
  readonly configSources: AutoCompactionConfig["sources"]
}

interface ContextMessageLike {
  readonly id?: unknown
  readonly role?: unknown
  readonly content?: unknown
  readonly reasoning?: unknown
  readonly toolCalls?: unknown
  readonly diffs?: unknown
  readonly questions?: unknown
  readonly answeredQuestions?: unknown
  readonly attachments?: unknown
  readonly compactedContext?: unknown
  readonly compactionGeneration?: unknown
  readonly dispatchStatus?: unknown
  readonly dispatchFailed?: unknown
  readonly createdAt?: unknown
}

export interface AutoCompactionTranscriptInput {
  readonly threadTitle?: string | null
  readonly projectPath?: string | null
  readonly messages: ReadonlyArray<unknown>
  /**
   * The renderer may optimistically persist the incoming user message before
   * `/chat/send` reaches the backend. It is dispatched separately and must
   * never be included in the summary or counted twice in the threshold.
   */
  readonly excludeMessageId?: string | null
}

/**
 * Resolve the effective compaction settings from the already precedence-ordered
 * project config projection. Later entries win, including environment
 * overrides such as the disable-autocompact flag.
 */
export function resolveAutoCompactionConfig(
  settings: ReadonlyArray<AutoCompactionProjectSetting>
): AutoCompactionConfig {
  let enabled = true
  let reservedTokens: number | null = null
  let preserveRecentTokens: number | null = null
  let tailTurns = DEFAULT_TAIL_TURNS
  let enabledSource: string | null = null
  let reservedSource: string | null = null
  let preserveSource: string | null = null
  let tailSource: string | null = null

  for (const setting of settings) {
    switch (setting.key) {
      case "compaction.auto": {
        const parsed = parseToggle(setting.value)
        if (parsed === null) break
        enabled = parsed
        enabledSource = setting.sourcePath ?? null
        break
      }
      case "compaction.reserved": {
        const parsed = parseNonnegativeInteger(setting.value)
        if (parsed === null) break
        reservedTokens = parsed
        reservedSource = setting.sourcePath ?? null
        break
      }
      case "compaction.preserve_recent_tokens": {
        const parsed = parseNonnegativeInteger(setting.value)
        if (parsed === null) break
        preserveRecentTokens = parsed
        preserveSource = setting.sourcePath ?? null
        break
      }
      case "compaction.tail_turns": {
        const parsed = parseNonnegativeInteger(setting.value)
        if (parsed === null) break
        tailTurns = parsed
        tailSource = setting.sourcePath ?? null
        break
      }
    }
  }

  return {
    enabled,
    reservedTokens,
    preserveRecentTokens,
    tailTurns,
    sources: {
      enabled: enabledSource,
      reservedTokens: reservedSource,
      preserveRecentTokens: preserveSource,
      tailTurns: tailSource,
    },
  }
}

/**
 * Pure, deterministic threshold decision. This never mutates a thread and is
 * deliberately evaluated before the UI submits the next provider turn.
 */
export function decideAutoCompaction(
  input: AutoCompactionDecisionInput
): AutoCompactionDecision {
  const estimatedTokens = nonnegativeInteger(input.estimatedTokens)
  const incomingTokens = nonnegativeInteger(input.incomingTokens)
  const reportedUsedTokens = nullableNonnegativeInteger(input.usedTokens)
  const usedTokens = Math.max(estimatedTokens, reportedUsedTokens ?? 0)
  const projectedTokens = saturatingAdd(usedTokens, incomingTokens)
  const maxTokens = positiveInteger(input.maxTokens)
  const modelInputTokens = positiveInteger(input.modelInputTokens)
  const modelOutputTokens = positiveInteger(input.modelOutputTokens)
  const capacity = modelInputTokens ?? maxTokens
  const defaultReservedTokens =
    modelInputTokens === null
      ? (modelOutputTokens ?? DEFAULT_RESERVED_TOKENS)
      : Math.min(
          DEFAULT_RESERVED_TOKENS,
          modelOutputTokens ?? DEFAULT_RESERVED_TOKENS
        )
  const reservedTokens = input.config.reservedTokens ?? defaultReservedTokens
  const thresholdTokens =
    capacity === null ? null : Math.max(0, capacity - reservedTokens)
  const preserveRecentTokens =
    input.config.preserveRecentTokens ??
    defaultPreserveRecentTokens(thresholdTokens)
  const completedTurns = nonnegativeInteger(input.completedTurns)
  const compactableTokens = Math.max(0, usedTokens - preserveRecentTokens)

  const base = {
    enabled: input.config.enabled,
    compactsAutomatically: input.compactsAutomatically === true,
    usedTokens,
    estimatedTokens,
    incomingTokens,
    projectedTokens,
    maxTokens,
    thresholdTokens,
    reservedTokens,
    preserveRecentTokens,
    tailTurns: input.config.tailTurns,
    completedTurns,
    compactableTokens,
    compactionGeneration: nonnegativeInteger(input.compactionGeneration ?? 0),
    precondition: {
      compactionGeneration: nonnegativeInteger(input.compactionGeneration ?? 0),
      lastMessageId:
        typeof input.lastMessageId === "string" ? input.lastMessageId : null,
    },
    configSources: input.config.sources,
  }

  if (input.configAvailable === false) {
    return decision(base, false, "config-unavailable")
  }
  if (!input.config.enabled) {
    return decision(base, false, "disabled")
  }
  if (input.compactsAutomatically === true) {
    return decision(base, false, "provider-native")
  }
  if (input.turnActive === true) {
    return decision(base, false, "turn-active")
  }
  if (capacity === null) {
    return decision(base, false, "context-window-unknown")
  }
  if (
    thresholdTokens === null ||
    thresholdTokens <= 0 ||
    reservedTokens >= capacity
  ) {
    return decision(base, false, "invalid-budget")
  }
  if (projectedTokens < thresholdTokens) {
    return decision(base, false, "below-threshold")
  }

  // The current compacter summarizes the bounded active transcript. Requiring
  // history older than the configured tail prevents a fresh checkpoint (or a
  // tiny conversation dominated by one oversized incoming prompt) from being
  // compacted repeatedly without reclaiming meaningful context.
  if (completedTurns <= input.config.tailTurns) {
    return decision(base, false, "insufficient-history")
  }
  if (compactableTokens < MIN_COMPACTABLE_TOKENS) {
    return decision(base, false, "preserve-budget")
  }
  return decision(base, true, "threshold-reached")
}

export function estimateIncomingTokens(content: string): number {
  return Math.ceil(content.length / TOKENS_PER_ESTIMATED_CHARACTER)
}

/**
 * Build the server-side context estimate from durable messages only. The
 * estimator is intentionally bounded and saturating: malformed or unusually
 * large persisted tool payloads cannot turn a read-only decision into an
 * unbounded stringify/allocation.
 */
export function autoCompactionContextSnapshot(
  messages: ReadonlyArray<unknown>,
  options: { readonly excludeMessageId?: string | null } = {}
): AutoCompactionContextSnapshot {
  const normalized = messages
    .filter(isContextMessage)
    .filter(
      (message) =>
        !options.excludeMessageId || message.id !== options.excludeMessageId
    )
    .filter(isUsableContextMessage)
  const boundaryIndex = latestCompactionBoundary(normalized)
  const active =
    boundaryIndex < 0 ? normalized : normalized.slice(boundaryIndex)
  let characters = 0
  let completedTurns = 0
  let pendingUserTurn = false

  for (const message of active) {
    characters = saturatingCharacters(
      characters,
      estimateMessageCharacters(message)
    )
    if (message.compactedContext === true) continue
    if (message.role === "user") {
      pendingUserTurn = true
      continue
    }
    if (message.role === "assistant" && pendingUserTurn) {
      completedTurns += 1
      pendingUserTurn = false
    }
  }

  const boundary =
    boundaryIndex < 0 ? null : (normalized[boundaryIndex] ?? null)
  return {
    estimatedTokens: Math.ceil(characters / TOKENS_PER_ESTIMATED_CHARACTER),
    completedTurns,
    compactionGeneration:
      boundary && typeof boundary.compactionGeneration === "number"
        ? nonnegativeInteger(boundary.compactionGeneration)
        : 0,
    boundaryCreatedAt:
      boundary && typeof boundary.createdAt === "string"
        ? boundary.createdAt
        : null,
    lastMessageId:
      typeof normalized.at(-1)?.id === "string"
        ? (normalized.at(-1)!.id as string)
        : null,
  }
}

/**
 * Build a bounded transcript from the durable active context. This mirrors the
 * renderer's historical compacter envelope without trusting renderer history:
 * the newest 90 useful messages are retained, individual payloads are clipped,
 * and the final transcript cannot exceed 60k characters.
 */
export function buildAutoCompactionTranscript(
  input: AutoCompactionTranscriptInput
): string | null {
  const normalized = input.messages
    .filter(isContextMessage)
    .filter(
      (message) =>
        !input.excludeMessageId || message.id !== input.excludeMessageId
    )
    .filter(isUsableContextMessage)
  const boundaryIndex = latestCompactionBoundary(normalized)
  const active =
    boundaryIndex < 0 ? normalized : normalized.slice(boundaryIndex)
  const useful = active.filter(hasUsefulCompactionContext)
  if (useful.length === 0) return null

  const candidates = useful.slice(-MAX_COMPACTION_MESSAGES)
  const blocks: string[] = []
  let omitted = useful.length - candidates.length
  let bodyCharacters = 0

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]!
    const block = formatCompactionMessage(message, index + omitted + 1)
    const separatorCharacters = blocks.length > 0 ? 2 : 0
    const nextCharacters =
      bodyCharacters + separatorCharacters + block.length
    if (
      blocks.length > 0 &&
      nextCharacters > MAX_COMPACTION_TRANSCRIPT_CHARACTERS * 0.82
    ) {
      omitted += index + 1
      break
    }
    blocks.unshift(block)
    bodyCharacters = nextCharacters
  }

  const lines = [
    "Thread metadata:",
    `- Title: ${compactInline(input.threadTitle || "Untitled thread", 160)}`,
    input.projectPath
      ? `- Workspace: ${compactInline(input.projectPath, 220)}`
      : "- Workspace: not set",
    `- Messages compacted: ${useful.length}`,
    ...(omitted > 0 ? [`- Older messages omitted: ${omitted}`] : []),
    "",
    "Compact transcript:",
    ...blocks,
  ]
  return clipText(lines.join("\n"), MAX_COMPACTION_TRANSCRIPT_CHARACTERS)
}

function decision(
  base: Omit<AutoCompactionDecision, "shouldCompact" | "reason">,
  shouldCompact: boolean,
  reason: AutoCompactionDecisionReason
): AutoCompactionDecision {
  return { ...base, shouldCompact, reason }
}

function defaultPreserveRecentTokens(thresholdTokens: number | null): number {
  const usable = thresholdTokens ?? 0
  return Math.min(
    MAX_PRESERVE_RECENT_TOKENS,
    Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable * 0.25))
  )
}

function parseToggle(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (["enabled", "true", "1", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["disabled", "false", "0", "no", "off"].includes(normalized)) {
    return false
  }
  return null
}

function parseNonnegativeInteger(value: string): number | null {
  const normalized = value.trim().replaceAll(",", "")
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function positiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

function nullableNonnegativeInteger(
  value: number | null | undefined
): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function nonnegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function saturatingAdd(left: number, right: number): number {
  const result = left + right
  return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER
}

function isContextMessage(value: unknown): value is ContextMessageLike {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isUsableContextMessage(message: ContextMessageLike): boolean {
  return (
    message.dispatchFailed !== true &&
    message.dispatchStatus !== "failed" &&
    message.dispatchStatus !== "uncertain" &&
    message.dispatchStatus !== "reverted"
  )
}

function latestCompactionBoundary(
  messages: ReadonlyArray<ContextMessageLike>
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "assistant") continue
    if (message.compactedContext === true) return index
    const previous = messages[index - 1]
    if (
      typeof message.content === "string" &&
      message.content.startsWith("# Compacted Session Context") &&
      previous?.role === "user" &&
      typeof previous.content === "string" &&
      /^\/compact(?:\s|$)/iu.test(previous.content.trim())
    ) {
      return index
    }
  }
  return -1
}

function estimateMessageCharacters(message: ContextMessageLike): number {
  let characters = 0
  characters = addStringCharacters(characters, message.content)
  characters = addStringCharacters(characters, message.reasoning)

  if (Array.isArray(message.toolCalls)) {
    for (const toolCall of message.toolCalls.slice(
      0,
      MAX_TOOL_CALLS_PER_MESSAGE
    )) {
      characters = saturatingCharacters(
        characters,
        boundedJsonCharacters(toolCall)
      )
    }
  }
  if (Array.isArray(message.attachments)) {
    for (const attachment of message.attachments.slice(0, 32)) {
      characters = saturatingCharacters(
        characters,
        boundedJsonCharacters(attachment)
      )
    }
  }
  return characters
}

function hasUsefulCompactionContext(message: ContextMessageLike): boolean {
  return (
    (typeof message.content === "string" &&
      message.content.trim().length > 0) ||
    (typeof message.reasoning === "string" &&
      message.reasoning.trim().length > 0) ||
    (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) ||
    (Array.isArray(message.diffs) && message.diffs.length > 0) ||
    (Array.isArray(message.questions) && message.questions.length > 0) ||
    (Array.isArray(message.answeredQuestions) &&
      message.answeredQuestions.length > 0)
  )
}

function formatCompactionMessage(
  message: ContextMessageLike,
  ordinal: number
): string {
  const role =
    typeof message.role === "string" && message.role.trim()
      ? message.role.trim().toUpperCase()
      : "MESSAGE"
  const timestamp =
    typeof message.createdAt === "string" && message.createdAt.trim()
      ? ` (${compactInline(message.createdAt, 64)})`
      : ""
  const lines = [`### ${ordinal}. ${role}${timestamp}`]
  if (typeof message.content === "string" && message.content.trim()) {
    lines.push(
      clipText(
        normalizeBlock(message.content),
        MAX_COMPACTION_MESSAGE_CHARACTERS
      )
    )
  }
  if (typeof message.reasoning === "string" && message.reasoning.trim()) {
    lines.push(
      `Reasoning: ${clipText(
        normalizeBlock(message.reasoning),
        Math.floor(MAX_COMPACTION_MESSAGE_CHARACTERS / 2)
      )}`
    )
  }
  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    lines.push("Tool calls:")
    for (const toolCall of message.toolCalls.slice(
      0,
      MAX_COMPACTION_TOOL_CALLS_PER_MESSAGE
    )) {
      lines.push(`- ${clipText(boundedJson(toolCall), 900)}`)
    }
    if (message.toolCalls.length > MAX_COMPACTION_TOOL_CALLS_PER_MESSAGE) {
      lines.push(
        `- [${message.toolCalls.length - MAX_COMPACTION_TOOL_CALLS_PER_MESSAGE} more tool calls omitted]`
      )
    }
  }
  if (Array.isArray(message.diffs) && message.diffs.length > 0) {
    lines.push("File changes:")
    for (const diff of message.diffs.slice(
      0,
      MAX_COMPACTION_DIFFS_PER_MESSAGE
    )) {
      const record =
        diff && typeof diff === "object" && !Array.isArray(diff)
          ? (diff as Record<string, unknown>)
          : {}
      const path =
        typeof record.path === "string" ? compactInline(record.path, 300) : null
      const additions =
        typeof record.additions === "number" ? record.additions : null
      const deletions =
        typeof record.deletions === "number" ? record.deletions : null
      lines.push(
        path
          ? `- ${path}${additions !== null && deletions !== null ? ` (+${additions}/-${deletions})` : ""}`
          : `- ${clipText(boundedJson(diff), 500)}`
      )
    }
    if (message.diffs.length > MAX_COMPACTION_DIFFS_PER_MESSAGE) {
      lines.push(
        `- [${message.diffs.length - MAX_COMPACTION_DIFFS_PER_MESSAGE} more file changes omitted]`
      )
    }
  }
  return lines.join("\n")
}

function normalizeBlock(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim()
}

function compactInline(value: string, maxCharacters: number): string {
  return clipText(value.replace(/\s+/g, " ").trim(), maxCharacters)
}

function clipText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value
  return `${value.slice(0, Math.max(0, maxCharacters - 14)).trimEnd()}… [truncated]`
}

function boundedJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return "[unserializable payload]"
  }
}

function addStringCharacters(current: number, value: unknown): number {
  return typeof value === "string"
    ? saturatingCharacters(current, value.length)
    : current
}

function boundedJsonCharacters(value: unknown): number {
  try {
    const json = JSON.stringify(value)
    return Math.min(json?.length ?? 0, 1_000_000)
  } catch {
    return 0
  }
}

function saturatingCharacters(current: number, addition: number): number {
  return Math.min(
    MAX_ESTIMATED_CHARACTERS,
    Math.max(0, current) + Math.max(0, addition)
  )
}
