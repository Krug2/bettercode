import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThreadTurnCoordinator } from "../../threadTurnCoordinator"
import { ProviderHub, ProviderTurnConflictError } from "../ProviderHub"
import type { ProviderRuntimeEvent, ThreadId } from "../contracts"
import { ClaudeAdapter } from "./ClaudeAdapter"

const queryMock = vi.hoisted(() => vi.fn())

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function answerQuery(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "assistant",
        uuid: `assistant-${text}`,
        session_id: "claude-conversation",
        message: { content: [{ type: "text", text }] },
      }
      yield { type: "result", subtype: "success", session_id: "claude-conversation" }
    },
    interrupt: vi.fn(),
    close: vi.fn(),
  }
}

const threadId = "claude-stop-continue" as ThreadId
const input = { threadId, message: "hello", modelId: "claude-opus-4-7", history: [] }
const hubs: ProviderHub[] = []

function createRuntime(afterTurn?: (event: ProviderRuntimeEvent) => Promise<void>) {
  const adapter = new ClaudeAdapter()
  vi.spyOn(adapter, "isConfigured").mockReturnValue(true)
  const startSession = vi.spyOn(adapter, "startSession")
  const coordinator = new ThreadTurnCoordinator()
  const hub = new ProviderHub({ adapters: [adapter], threadTurnCoordinator: coordinator, afterTurn })
  hubs.push(hub)
  const events: ProviderRuntimeEvent[] = []
  hub.subscribe((event) => events.push(event))
  return { adapter, hub, coordinator, events, startSession }
}

describe("Claude session continuity through ProviderHub", () => {
  beforeEach(() => queryMock.mockReset())
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.stopAll()
    vi.restoreAllMocks()
  })

  it("continues the same conversation when Stop arrives after the answer completed", async () => {
    queryMock.mockReturnValueOnce(answerQuery("first")).mockReturnValueOnce(answerQuery("continued"))
    const { adapter, hub, coordinator, events, startSession } = createRuntime()
    await hub.startTurn("claude", input).settled
    const snapshot = await adapter.readThread(threadId)

    await hub.interruptTurn("claude", threadId)
    const continued = hub.startTurn("claude", { ...input, message: "mach weiter" })
    await continued.settled

    expect(startSession).toHaveBeenCalledOnce()
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls[1]?.[0]?.options).toMatchObject({
      resume: "claude-conversation", resumeSessionAt: "assistant-first",
    })
    const continuedSnapshot = await adapter.readThread(threadId)
    expect(continuedSnapshot.turns.slice(0, 1)).toEqual(snapshot.turns)
    expect(continuedSnapshot.turns).toHaveLength(2)
    expect(continuedSnapshot.turns[1]?.items).toContainEqual(expect.objectContaining({
      type: "assistant", message: { content: [{ type: "text", text: "continued" }] },
    }))
    expect(events.filter((event) => event.type === "runtime.error")).toEqual([])
    expect(coordinator.activeOwner(threadId)).toBeNull()
    await hub.stopSession("claude", threadId)
    expect(adapter.hasSession(threadId)).toBe(false)
    expect(await adapter.listSessions()).toEqual([])
  })

  it("keeps the session visible during interruption and admits the next turn only after finalization", async () => {
    const streamEntered = deferred()
    const streamReleased = deferred()
    const finalizationEntered = deferred()
    const finalizationReleased = deferred()
    queryMock.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "claude-conversation" }
        streamEntered.resolve()
        await streamReleased.promise
      },
      interrupt: vi.fn(() => streamReleased.resolve()),
      close: vi.fn(),
    }).mockReturnValueOnce(answerQuery("continued"))
    const { adapter, hub, coordinator, startSession } = createRuntime(async (event) => {
      if (event.type !== "turn.aborted") return
      finalizationEntered.resolve()
      await finalizationReleased.promise
    })
    const first = hub.startTurn("claude", input)
    await streamEntered.promise
    expect(() => hub.startTurn("claude", input)).toThrow(ProviderTurnConflictError)
    const stopping = hub.interruptTurn("claude", threadId)
    await finalizationEntered.promise
    try {
      expect(adapter.hasSession(threadId)).toBe(true)
      expect(await adapter.listSessions()).toEqual([
        expect.objectContaining({ threadId, activeTurnId: null, status: "ready" }),
      ])
      expect(coordinator.activeOwner(threadId)).not.toBeNull()
      expect(() => hub.startTurn("claude", input)).toThrow(ProviderTurnConflictError)
      expect(queryMock).toHaveBeenCalledOnce()
    } finally {
      finalizationReleased.resolve()
      await stopping
      await first.settled
    }
    expect(coordinator.activeOwner(threadId)).toBeNull()
    await hub.startTurn("claude", { ...input, message: "mach weiter" }).settled
    expect(startSession).toHaveBeenCalledOnce()
    expect(queryMock.mock.calls[1]?.[0]?.options.resume).toBe("claude-conversation")
  })

  it("releases a failed SDK turn and delivers the next answer without resetting the session", async () => {
    queryMock.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "claude-conversation" }
        throw new Error("test SDK stream disconnected")
      },
      interrupt: vi.fn(), close: vi.fn(),
    }).mockReturnValueOnce(answerQuery("recovered"))
    const { hub, coordinator, events, startSession } = createRuntime()
    await hub.startTurn("claude", input).settled
    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      expect.objectContaining({ status: "failed" }),
    ])
    expect(coordinator.activeOwner(threadId)).toBeNull()
    await hub.startTurn("claude", { ...input, message: "try again" }).settled
    expect(startSession).toHaveBeenCalledOnce()
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(2)
    expect(events.filter((event) => event.type === "turn.completed").at(-1)).toMatchObject({ status: "completed" })
  })

  it("blocks a second dispatch until an interrupted SDK stream unwinds and discards its late output", async () => {
    const streamEntered = deferred()
    const streamReleased = deferred()
    queryMock.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        streamEntered.resolve()
        await streamReleased.promise
        yield { type: "assistant", message: { content: [{ type: "text", text: "stale answer" }] } }
      },
      interrupt: vi.fn(async () => {}), close: vi.fn(),
    }).mockReturnValueOnce(answerQuery("continued"))
    const { hub, coordinator, events } = createRuntime()
    const first = hub.startTurn("claude", input)
    await streamEntered.promise
    vi.useFakeTimers()
    const stopping = hub.interruptTurn("claude", threadId)
    try {
      await vi.advanceTimersByTimeAsync(4_100)
      expect(events.filter((event) => event.type === "turn.aborted")).toHaveLength(1)
      expect(coordinator.activeOwner(threadId)).not.toBeNull()
      expect(() => hub.startTurn("claude", input)).toThrow(ProviderTurnConflictError)
      expect(queryMock).toHaveBeenCalledOnce()
    } finally {
      streamReleased.resolve()
      await stopping
      await first.settled
      vi.useRealTimers()
    }
    await hub.startTurn("claude", { ...input, message: "mach weiter" }).settled
    expect(events.filter((event) => event.type === "turn.aborted")).toHaveLength(1)
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain("stale answer")
    expect(coordinator.activeOwner(threadId)).toBeNull()
  })
})
