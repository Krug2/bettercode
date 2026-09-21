import type {
  ToolCall,
  TokenUsage,
  ChatQuestion,
  ChatMessage,
  ChatThread,
  DesignBrief,
  ThreadActivity,
  ThreadGoal,
} from "@betterc0de/schema"
import type { ProviderComposerSelectionMap } from "@/lib/provider-composer-selection"

export type AutonomousStatus = "idle" | "working" | "paused" | "completed"

/** Reason an autonomous run stopped — surfaced to the user in the status bar. */
export type AutonomousStopReason =
  | "user"
  | "max-iterations"
  | "time-budget"
  | "completion-signal"
  | "error"

/** Single task row in an Autonomous Work run. */
export interface AutonomousTask {
  id: string
  text: string
  done: boolean
}

export interface FinalizeStreamOptions {
  readonly messageId?: string
  readonly persist?: boolean
  readonly keepTurnActive?: boolean
}

/** One finished stretch of thinking, with the time it took. */
export interface ReasoningSegment {
  readonly id: string
  readonly text: string
  readonly startedAt: number | null
  readonly endedAt: number | null
}

/** Per-thread streaming state — each chat gets its own independent stream */
export interface ThreadStreamState {
  isStreaming: boolean
  streamingText: string
  streamingPlanText: string
  isPlanStreaming: boolean
  reasoningText: string
  isReasoning: boolean
  /**
   * Reasoning the agent finished before doing something else — running a
   * tool, or starting to answer. Kept as separate entries so a long turn
   * retains every phase and its timing. The UI groups them into one disclosure
   * without replacing earlier reasoning when a new phase starts.
   *
   * `reasoningText` remains the segment currently being written.
   */
  reasoningSegments: ReasoningSegment[]
  /** Timestamps of the first/last reasoning delta — used to persist the
      actual thinking duration onto the finalized assistant message. */
  reasoningStartedAt: number | null
  reasoningEndedAt: number | null
  /**
   * When the agent last did something other than think: the turn started,
   * answer text arrived, a tool started or finished. A reasoning block that
   * is delivered in one piece is timed from here — its own deltas span only
   * the delivery, which read as "Thought for 69ms" after a minute of work.
   */
  lastBoundaryAt: number | null
  streamingModelId: string | null
  streamingTools: ToolCall[]
  streamingTasks: { text: string; completed: boolean }[]
  streamingDiffs: {
    path: string
    additions: number
    deletions: number
    oldText: string
    newText: string
    isNew: boolean
  }[]
  pendingQuestions: ChatQuestion[]
  activeTurnId: string | null
}

export const emptyStreamState: ThreadStreamState = {
  isStreaming: false,
  streamingText: "",
  streamingPlanText: "",
  isPlanStreaming: false,
  reasoningText: "",
  isReasoning: false,
  reasoningSegments: [],
  reasoningStartedAt: null,
  reasoningEndedAt: null,
  lastBoundaryAt: null,
  streamingModelId: null,
  streamingTools: [],
  streamingTasks: [],
  streamingDiffs: [],
  pendingQuestions: [],
  activeTurnId: null,
}

/**
 * Per-thread composer settings. Every field is optional so a fresh thread
 * inherits whatever the global preferences (`usePreferencesStore`) are
 * set to when it was created — writes via `setThreadSetting` ONLY touch
 * the active thread, so flipping Plan mode in tab 1 no longer leaks into
 * tabs 3 / 4. `useAppPreferences` merges this map over the global
 * preferences at read time.
 */
export interface ThreadSettings {
  /** Per-chat provider permission pool. The selected chat model remains the coordinator. */
  orchestration?: import("@betterc0de/schema").ChatOrchestration
  orchestrationWorker?: boolean
  chatMode?: string
  thinkingMode?: string | null
  selectedModel?: string
  selectedProviderId?: string
  modelSelectionByProvider?: ProviderComposerSelectionMap
  permissionLevel?: string
  contextWindow?: "200k" | "1m"
  specialMode?: string | null
  designBrief?: DesignBrief
  /** Design-mode canvas: last preview URL for this thread's artboard. */
  designPreviewUrl?: string
  designPreviewSource?: import("@/lib/canvas-preview-source").CanvasPreviewSource
  /** Design-mode canvas: selected artboard device preset id. */
  designDevicePreset?: string
  /** Live devices shown together inside this chat's project frame. */
  designDevicePresets?: Array<"desktop" | "tablet" | "mobile">
  /** Design-mode canvas: the card's own size factor on top of the half-size
      preview (1 = default, clamped to the CARD_SCALE range). */
  designCardScale?: number
  /** Canvas card: show the runtime pane (requests, endpoints, logs, tools). */
  designRuntimePane?: boolean
  /** Provider-native `/goal` state mirrored into BetterC0de's composer UI. */
  goal?: ThreadGoal | null
  /** Local revision fences slow snapshots against newer provider metadata, including clears. */
  goalRevision?: number
}

export type { ThreadGoal, ThreadGoalStatus } from "@betterc0de/schema"

export interface CreateThreadOptions {
  envMode?: string | null
  branch?: string | null
  worktreePath?: string | null
  baseBranch?: string | null
  worktreeState?: string | null
  parentThreadId?: string | null
}

export type ThreadContextPatch = Partial<
  Pick<
    ChatThread,
    | "projectName"
    | "projectPath"
    | "envMode"
    | "branch"
    | "worktreePath"
    | "baseBranch"
    | "worktreeState"
    | "parentThreadId"
  >
>

/**
 * LRU cache sizing. We keep the last N threads' messages resident; older
 * threads have their `messages` array dropped (the thread itself stays in
 * the sidebar, just skeletal). Re-opening an evicted thread triggers a
 * single `loadMessages` call which fills it back in within ~20–50ms.
 *
 * 10 is a sweet spot: average users hop between 2–4 threads per session,
 * so the cap is rarely hit; power users with many open sessions still keep
 * memory bounded (10 × ~1–5 MB of rendered messages).
 */
export const LRU_CAPACITY = 10

/** Debounce delay (ms) for persisting thread state to SQLite after edits. */
export const PERSIST_DEBOUNCE_MS = 500

/** Default cap for autonomous-mode iterations before the agent pauses. */
export const AUTONOMOUS_MAX_ITERATIONS = 50

/**
 * Default wall-clock budget for an autonomous run, in minutes. User-configurable
 * from the Autonomous Work dialog; 0 means "no time limit" (only iterations cap
 * applies). 90 min is a minimum floor suggested by the user — feel free to raise.
 */
export const AUTONOMOUS_DEFAULT_TIME_BUDGET_MIN = 90

export interface ChatState {
  threads: ChatThread[]
  activeThreadId: string | null
  /** Per-thread streaming state keyed by threadId */
  streamingByThread: Record<string, ThreadStreamState>
  activitiesByThread: Record<string, ThreadActivity[]>
  activitiesLoadedByThread: Record<string, boolean>
  messagesLoadedByThread: Record<string, boolean>
  messageHydrationErrorsByThread: Record<string, string>
  lruOrder: string[]
  pinnedThreadIds: Set<string>
  draftsByThread: Record<string, string>
  /** Per-thread composer settings (mode, model, thinking, permission, …).
   *  An empty entry means "inherit global prefs". Writes to the active
   *  thread's settings never leak into other threads — see the Plan-mode
   *  tab-leak bug (pre-fix: changing Chat 1 to Plan flipped Chat 3+4 too). */
  settingsByThread: Record<string, ThreadSettings>
  lastUsage: TokenUsage | null

  // Autonomous Work Mode (structured task list + time budget)
  autonomousMode: boolean
  autonomousThreadId: string | null
  /** Free-text one-liner summary; kept for legacy status-bar title + back-compat. */
  autonomousTask: string | null
  autonomousStatus: AutonomousStatus
  autonomousIterations: number
  autonomousMaxIterations: number
  /** Structured task list the harness iterates through. */
  autonomousTaskList: AutonomousTask[] | null
  /** Wall-clock budget in minutes; 0 = no limit. */
  autonomousTimeBudgetMin: number
  /** Epoch ms the run started at; null when idle. Not persisted across reloads. */
  autonomousStartedAt: number | null
  /** Why the last run stopped; null while running or before first run. */
  autonomousStopReason: AutonomousStopReason | null

  // Actions
  setActiveThread: (id: string | null) => void
  hydrateThreadMessages: (threadId: string, force?: boolean) => Promise<void>
  hydrateThreadActivities: (threadId: string, force?: boolean) => Promise<void>
  setDraft: (threadId: string, text: string) => void
  getDraft: (threadId: string) => string
  /** Sets a single composer-setting field on the given thread. Only this
   *  thread's row in `settingsByThread` is touched — other threads keep
   *  reading their own override or falling through to the global pref. */
  setThreadSetting: <K extends keyof ThreadSettings>(
    threadId: string,
    key: K,
    value: ThreadSettings[K]
  ) => void
  getThreadSettings: (threadId: string | null | undefined) => ThreadSettings
  initializeThreadModelSettings: (threadId: string) => void
  pinThread: (threadId: string) => void
  unpinThread: (threadId: string) => void
  createThread: (
    title: string,
    projectName: string,
    projectPath?: string,
    options?: CreateThreadOptions
  ) => string
  /**
   * Branches a chat, keeping the original. `into` rebinds the fork to another
   * project folder — that is how a folder-less chat becomes a repo-scoped one
   * without losing the conversation it grew out of.
   */
  /** Seals the current reasoning stretch into its own block. */
  closeReasoningSegment: (threadId: string) => void
  forkThread: (
    sourceThreadId: string,
    into?: { projectPath: string; projectName: string }
  ) => Promise<string | null>
  addMessage: (
    threadId: string,
    message: ChatMessage,
    options?: { persist?: boolean }
  ) => void
  appendStreamDelta: (threadId: string, delta: string) => void
  appendPlanStreamDelta: (threadId: string, delta: string) => void
  replacePlanStreamText: (threadId: string, text: string) => void
  appendReasoningDelta: (threadId: string, delta: string) => void
  setStreamingModelId: (threadId: string, modelId: string) => void
  setActiveTurnId: (threadId: string, turnId: string | null) => void
  setThreadActivities: (threadId: string, activities: ThreadActivity[]) => void
  upsertThreadActivity: (threadId: string, activity: ThreadActivity) => void
  addToolCall: (threadId: string, toolCall: ToolCall) => void
  updateToolCallInput: (
    threadId: string,
    toolId: string,
    input: unknown
  ) => void
  appendToolOutputDelta: (
    threadId: string,
    toolId: string,
    delta: string,
    toolName?: string,
    providerKind?: string,
    providerInstanceId?: string,
    /** "replace" for a cumulative snapshot of the whole output; default appends a chunk. */
    mode?: "append" | "replace"
  ) => void
  updateToolResult: (
    threadId: string,
    toolId: string,
    output: unknown,
    providerKind?: string,
    providerInstanceId?: string
  ) => void
  updateToolFailure: (
    threadId: string,
    toolId: string,
    error: string,
    output?: unknown,
    providerKind?: string,
    providerInstanceId?: string
  ) => void
  addQuestion: (threadId: string, question: ChatQuestion) => void
  answerQuestion: (threadId: string, questionId: string, answer: string) => void
  dismissPendingQuestions: (threadId: string) => void
  finalizeStream: (threadId: string, options?: FinalizeStreamOptions) => void
  clearStreaming: (threadId?: string) => void
  deleteThread: (threadId: string) => void
  updateThreadTitle: (threadId: string, title: string) => void
  updateThreadContext: (threadId: string, patch: ThreadContextPatch) => void
  updateThreadUsage: (
    threadId: string,
    usage: TokenUsage & { usedTokens?: number; maxTokens?: number }
  ) => void
  setAutonomousMode: (enabled: boolean) => void
  setAutonomousTask: (task: string | null) => void
  setAutonomousStatus: (status: AutonomousStatus) => void
  incrementAutonomousIteration: () => void
  resetAutonomous: () => void
  setAutonomousMaxIterations: (n: number) => void
  setAutonomousIterations: (n: number) => void
  setAutonomousTaskList: (list: AutonomousTask[] | null) => void
  markAutonomousTaskDone: (id: string, done: boolean) => void
  setAutonomousTimeBudget: (min: number) => void
  setAutonomousStartedAt: (ts: number | null) => void
  setAutonomousStopReason: (reason: AutonomousStopReason | null) => void
}
