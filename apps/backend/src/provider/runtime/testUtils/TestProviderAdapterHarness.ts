import type {
  ApprovalRequestId,
  ProviderAdapterShape,
  ProviderApprovalDecision,
  ProviderCapabilities,
  ProviderKind,
  ProviderModel,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSkill,
  ProviderSlashCommand,
  ThreadId,
} from "../contracts"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export type HarnessProviderRuntimeEvent = DistributiveOmit<
  ProviderRuntimeEvent,
  "at" | "eventId" | "providerInstanceId" | "providerKind" | "threadId"
> &
  Partial<
    Pick<
      ProviderRuntimeEvent,
      "at" | "eventId" | "providerInstanceId" | "providerKind" | "threadId"
    >
  >

export interface TestTurnResponse {
  readonly events: ReadonlyArray<HarnessProviderRuntimeEvent>
  readonly mutateWorkspace?: (input: {
    readonly cwd: string
    readonly threadId: ThreadId
    readonly turnCount: number
  }) => Promise<void> | void
}

interface SessionState {
  readonly session: ProviderSession
  readonly queuedResponses: TestTurnResponse[]
  readonly sentTurns: ProviderSendTurnInput[]
  readonly interruptCalls: ThreadId[]
  readonly approvalResponses: Array<{
    readonly requestId: ApprovalRequestId
    readonly decision: ProviderApprovalDecision
  }>
  readonly rollbackCalls: number[]
  turnCount: number
}

export interface TestProviderAdapterHarness {
  readonly adapter: ProviderAdapterShape
  readonly provider: ProviderKind
  queueTurnResponse(threadId: ThreadId, response: TestTurnResponse): void
  queueTurnResponseForNextSession(response: TestTurnResponse): void
  getStartCount(): number
  getSentTurns(threadId: ThreadId): ReadonlyArray<ProviderSendTurnInput>
  getInterruptCalls(threadId: ThreadId): ReadonlyArray<ThreadId>
  getApprovalResponses(threadId: ThreadId): ReadonlyArray<{
    readonly requestId: ApprovalRequestId
    readonly decision: ProviderApprovalDecision
  }>
  getRollbackCalls(threadId: ThreadId): ReadonlyArray<number>
  listActiveSessionIds(): ReadonlyArray<ThreadId>
}

export interface MakeTestProviderAdapterHarnessOptions {
  readonly provider?: ProviderKind
  readonly displayName?: string
  readonly configured?: boolean
  readonly models?: ReadonlyArray<ProviderModel>
  readonly skills?: ReadonlyArray<ProviderSkill>
  readonly slashCommands?: ReadonlyArray<ProviderSlashCommand>
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsTools: true,
  supportsApprovals: true,
  supportsResume: true,
  managesOwnLifecycle: true,
}

export function makeTestProviderAdapterHarness(
  options: MakeTestProviderAdapterHarnessOptions = {}
): TestProviderAdapterHarness {
  const provider = options.provider ?? ("codex" as ProviderKind)
  const displayName = options.displayName ?? "Test Provider"
  const configured = options.configured ?? true
  const sessions = new Map<ThreadId, SessionState>()
  const queuedResponsesForNextSession: TestTurnResponse[] = []
  const listeners = new Set<(event: ProviderRuntimeEvent) => void>()
  let startCount = 0
  let eventSequence = 0

  function makeSession(
    threadId: ThreadId,
    cwd: string | null | undefined
  ): SessionState {
    startCount += 1
    const now = Date.now()
    const session: ProviderSession = {
      threadId,
      providerThreadId: `${provider}-${threadId}`,
      status: "ready",
      cwd: cwd ?? null,
      activeTurnId: null,
      createdAt: now,
      updatedAt: now,
    }
    const state: SessionState = {
      session,
      queuedResponses: queuedResponsesForNextSession.splice(0),
      sentTurns: [],
      interruptCalls: [],
      approvalResponses: [],
      rollbackCalls: [],
      turnCount: 0,
    }
    sessions.set(threadId, state)
    return state
  }

  function getOrStartSession(input: ProviderSendTurnInput): SessionState {
    const threadId = input.threadId as ThreadId
    return (
      sessions.get(threadId) ?? makeSession(threadId, input.projectPath ?? null)
    )
  }

  function normalizeEvent(
    raw: HarnessProviderRuntimeEvent,
    input: ProviderSendTurnInput,
    state: SessionState
  ): ProviderRuntimeEvent {
    eventSequence += 1
    const record = raw as Record<string, unknown>
    const turnId =
      typeof record.turnId === "string"
        ? record.turnId
        : `turn-${state.turnCount}`
    const lifecycleEvent =
      record.type === "turn.started" ||
      record.type === "turn.completed" ||
      record.type === "turn.aborted"
    const payload =
      record.payload &&
      typeof record.payload === "object" &&
      !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : {}
    return {
      ...record,
      threadId: input.threadId,
      providerKind: provider,
      ...(input.providerInstanceId
        ? { providerInstanceId: input.providerInstanceId }
        : {}),
      eventId:
        typeof record.eventId === "string"
          ? record.eventId
          : `harness-event-${eventSequence}`,
      at:
        typeof record.at === "number"
          ? record.at
          : 1_777_000_000_000 + eventSequence,
      turnId,
      ...(lifecycleEvent && input.dispatchTurnId
        ? {
            payload: {
              ...payload,
              dispatchTurnId: input.dispatchTurnId,
            },
          }
        : {}),
    } as ProviderRuntimeEvent
  }

  function emit(event: ProviderRuntimeEvent): void {
    for (const listener of listeners) listener(event)
  }

  const adapter: ProviderAdapterShape = {
    provider,
    displayName,
    capabilities: DEFAULT_CAPABILITIES,
    isConfigured: () => configured,
    availableModels: async () => options.models ?? [],
    availableSkills: async () => options.skills ?? [],
    availableSlashCommands: async () => options.slashCommands ?? [],
    startSession: async (input) =>
      makeSession(input.threadId, input.cwd).session,
    listSessions: async () =>
      Array.from(sessions.values(), (state) => ({ ...state.session })),
    sendTurn: async (input) => {
      const state = getOrStartSession(input)
      state.turnCount += 1
      state.sentTurns.push(input)
      const response = state.queuedResponses.shift()
      if (!response) {
        throw new Error(`No queued turn response for thread ${input.threadId}`)
      }
      const deferredTurnCompletedEvents: ProviderRuntimeEvent[] = []
      let sawTerminalEvent = false
      for (const rawEvent of response.events) {
        const event = normalizeEvent(rawEvent, input, state)
        if (event.type === "turn.completed") {
          sawTerminalEvent = true
          deferredTurnCompletedEvents.push(event)
          continue
        }
        if (event.type === "runtime.error" || event.type === "turn.aborted") {
          sawTerminalEvent = true
        }
        emit(event)
      }
      if (response.mutateWorkspace && state.session.cwd) {
        await response.mutateWorkspace({
          cwd: state.session.cwd,
          threadId: input.threadId as ThreadId,
          turnCount: state.turnCount,
        })
      }
      if (deferredTurnCompletedEvents.length > 0) {
        for (const event of deferredTurnCompletedEvents) emit(event)
      } else if (!sawTerminalEvent) {
        emit(
          normalizeEvent(
            {
              type: "turn.completed",
              status: "completed",
            } as HarnessProviderRuntimeEvent,
            input,
            state
          )
        )
      }
    },
    interruptTurn: async (threadId) => {
      const state = sessions.get(threadId)
      if (state) state.interruptCalls.push(threadId)
    },
    respondToRequest: async (threadId, requestId, decision) => {
      const state = sessions.get(threadId)
      if (state) state.approvalResponses.push({ requestId, decision })
    },
    rollbackThread: async (threadId, numTurns) => {
      const state = sessions.get(threadId)
      if (state) state.rollbackCalls.push(numTurns)
    },
    stopSession: async (threadId) => {
      sessions.delete(threadId)
    },
    hasSession: (threadId) => sessions.has(threadId),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stopAll: async () => {
      sessions.clear()
    },
  }

  return {
    adapter,
    provider,
    queueTurnResponse(threadId, response) {
      const state = sessions.get(threadId)
      if (!state) throw new Error(`Session not found: ${threadId}`)
      state.queuedResponses.push(response)
    },
    queueTurnResponseForNextSession(response) {
      queuedResponsesForNextSession.push(response)
    },
    getStartCount: () => startCount,
    getSentTurns: (threadId) => sessions.get(threadId)?.sentTurns ?? [],
    getInterruptCalls: (threadId) =>
      sessions.get(threadId)?.interruptCalls ?? [],
    getApprovalResponses: (threadId) =>
      sessions.get(threadId)?.approvalResponses ?? [],
    getRollbackCalls: (threadId) => sessions.get(threadId)?.rollbackCalls ?? [],
    listActiveSessionIds: () => Array.from(sessions.keys()),
  }
}
