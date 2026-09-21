import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChatStore } from "@/lib/chat-store"
import { flushPendingDeltas, handleProviderEvent } from "@/lib/provider-events"

/**
 * The default vitest environment is `node`, which has no
 * `requestAnimationFrame`, so `provider-events.test.ts` exercises the
 * synchronous fallback. These tests install a controllable rAF to cover the
 * coalescing path that actually runs in the browser.
 */

let frameCallbacks: FrameRequestCallback[] = []

function runFrame(): void {
  const pending = frameCallbacks
  frameCallbacks = []
  for (const callback of pending) callback(0)
}

const THREAD = "thread-coalesce"

beforeEach(() => {
  vi.stubGlobal("window", {})
  frameCallbacks = []
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    callback: FrameRequestCallback
  ) => {
    frameCallbacks.push(callback)
    return frameCallbacks.length
  }
  useChatStore.setState({ streamingByThread: {} })
})

afterEach(() => {
  delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
  flushPendingDeltas()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function emitContentDelta(delta: string): void {
  handleProviderEvent(THREAD, "content_delta", { delta }, {
    projectActivities: false,
  })
}

function streamingText(): string {
  return useChatStore.getState().streamingByThread[THREAD]?.streamingText ?? ""
}

describe("streaming delta coalescing", () => {
  it("collapses many token deltas into a single store write per frame", () => {
    const appendSpy = vi.spyOn(useChatStore.getState(), "appendStreamDelta")

    for (const token of ["Hel", "lo", " wor", "ld"]) emitContentDelta(token)

    // Nothing applied yet — the whole point is that the intermediate
    // snapshots never exist.
    expect(appendSpy).not.toHaveBeenCalled()
    expect(streamingText()).toBe("")

    runFrame()

    expect(appendSpy).toHaveBeenCalledTimes(1)
    expect(streamingText()).toBe("Hello world")
  })

  it("keeps text intact across several frames", () => {
    emitContentDelta("one ")
    runFrame()
    emitContentDelta("two ")
    emitContentDelta("three")
    runFrame()

    expect(streamingText()).toBe("one two three")
  })

  // The ordering invariant: a non-append event must never overtake tokens
  // still sitting in the coalescer, or the transcript loses the tail of a
  // message whenever a turn ends inside the same frame.
  it("flushes buffered deltas before a non-delta event is handled", () => {
    emitContentDelta("buffered tail")
    expect(streamingText()).toBe("")

    handleProviderEvent(THREAD, "token_usage", { usage: {} }, {
      projectActivities: false,
    })

    expect(streamingText()).toBe("buffered tail")
  })

  it("coalesces reasoning separately from content and applies both", () => {
    emitContentDelta("answer ")
    handleProviderEvent(THREAD, "reasoning_delta", { delta: "think " }, {
      projectActivities: false,
    })
    handleProviderEvent(THREAD, "reasoning_delta", { delta: "more" }, {
      projectActivities: false,
    })

    expect(streamingText()).toBe("")
    runFrame()

    const stream = useChatStore.getState().streamingByThread[THREAD]
    expect(stream?.streamingText).toBe("answer ")
    expect(stream?.reasoningText).toBe("think more")
  })

  it("flushPendingDeltas() forces a barrier without a frame", () => {
    emitContentDelta("forced")
    expect(streamingText()).toBe("")
    flushPendingDeltas()
    expect(streamingText()).toBe("forced")
  })

  it("preserves reasoning boundaries when think and answer alternate in one frame", () => {
    const think = (delta: string) => handleProviderEvent(THREAD, "reasoning_delta", { delta }, { projectActivities: false })
    think("First thought")
    emitContentDelta("First answer. ")
    think("Second thought")
    emitContentDelta("Second answer.")
    runFrame()

    const stream = useChatStore.getState().streamingByThread[THREAD]!
    expect(stream.reasoningSegments.map((segment) => segment.text)).toEqual(["First thought", "Second thought"])
    expect(stream.streamingText).toBe("First answer. Second answer.")
    expect(stream.reasoningText).toBe("")
    expect(stream.isReasoning).toBe(false)
  })

  it.each(["item.updated", "item.completed"])("closes thinking on an ACP tool first reported as %s", (type) => {
    handleProviderEvent(THREAD, "reasoning.delta", { delta: "Inspect the workspace" }, { projectActivities: false })
    handleProviderEvent(THREAD, type, {
      providerKind: "grok-cli", itemId: "tool-1", itemType: "command_execution",
      title: "Shell", data: { input: { command: "Get-ChildItem" } },
    }, { projectActivities: false })
    runFrame()

    const stream = useChatStore.getState().streamingByThread[THREAD]!
    expect(stream.isReasoning).toBe(false)
    expect(stream.reasoningText).toBe("")
    expect(stream.reasoningSegments.map((segment) => segment.text)).toEqual(["Inspect the workspace"])
    expect(stream.streamingTools).toHaveLength(1)
    expect(stream.streamingTools[0]).toMatchObject({ id: "tool-1", name: "Shell" })
  })

  it("does not stop new thinking when an already-known background tool updates", () => {
    const tool = { itemId: "tool-1", itemType: "command_execution", title: "Shell", input: { command: "test" } }
    handleProviderEvent(THREAD, "item.updated", tool, { projectActivities: false })
    handleProviderEvent(THREAD, "reasoning.delta", { delta: "Another decision" }, { projectActivities: false })
    handleProviderEvent(THREAD, "item.completed", tool, { projectActivities: false })
    const stream = useChatStore.getState().streamingByThread[THREAD]!
    expect(stream.isReasoning).toBe(true)
    expect(stream.reasoningText).toBe("Another decision")
    expect(stream.streamingTools).toHaveLength(1)
  })

  // Regression: `requestAnimationFrame` is paused entirely while a window is
  // minimized or occluded. With rAF as the only clock, a chat streaming into a
  // backgrounded window buffered tokens that never rendered — the transcript
  // sat frozen until an unrelated non-delta event happened to hit the barrier.
  it("still flushes when frames are never delivered (hidden window)", () => {
    vi.useFakeTimers()
    try {
      // Accept the rAF registration but never invoke the callback, exactly as
      // a minimized window behaves.
      ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
        () => 1

      emitContentDelta("background token")
      expect(streamingText()).toBe("")

      vi.advanceTimersByTime(200)
      expect(streamingText()).toBe("background token")
    } finally {
      vi.useRealTimers()
    }
  })
})
