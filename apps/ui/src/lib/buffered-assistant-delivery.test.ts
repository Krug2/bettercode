import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChatStore } from "@/lib/chat-store"
import { useSettingsStore } from "@/lib/settings-store"
import { emptyStreamState } from "@/lib/chat/types"
import { flushPendingDeltas, handleProviderEvent } from "@/lib/provider-events"

const THREAD = "thread-buffered"

function streamingText(): string {
  return (
    useChatStore.getState().streamingByThread[THREAD] ?? emptyStreamState
  ).streamingText
}

function sendDelta(delta: string) {
  handleProviderEvent(THREAD, "content_delta", { delta })
}

let frameCallbacks: FrameRequestCallback[] = []

beforeEach(() => {
  useChatStore.setState({ streamingByThread: {} })
  frameCallbacks = []
  // Hold frames so the test controls when a coalesced flush happens; without
  // this the assertions would race the real animation frame.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb)
    return frameCallbacks.length
  })
  vi.stubGlobal("cancelAnimationFrame", () => {})
  // The event handlers reach for browser globals on some paths; this suite
  // runs in the node environment, so give them just enough to not throw.
  vi.stubGlobal("window", { dispatchEvent: () => true })
  vi.stubGlobal(
    "CustomEvent",
    class {
      type: string
      constructor(type: string) {
        this.type = type
      }
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  flushPendingDeltas()
})

function runFrame() {
  const callbacks = frameCallbacks
  frameCallbacks = []
  for (const cb of callbacks) cb(0)
}

/**
 * With assistant streaming switched off the answer should land whole rather
 * than typing itself out. Reasoning and tool activity keep flowing, so the
 * user still sees the agent working — only the finished text waits.
 */
describe("buffered assistant delivery", () => {
  it("streams token by token while the setting is on", () => {
    useSettingsStore.setState({ enableAssistantStreaming: true })
    sendDelta("Hello ")
    sendDelta("world")
    runFrame()
    expect(streamingText()).toBe("Hello world")
  })

  it("holds the answer while the setting is off", () => {
    useSettingsStore.setState({ enableAssistantStreaming: false })
    sendDelta("Hello ")
    sendDelta("world")
    runFrame()
    // Nothing scheduled a flush, so the frame carried no text.
    expect(streamingText()).toBe("")
  })

  it("releases the held answer at the next interaction boundary", () => {
    useSettingsStore.setState({ enableAssistantStreaming: false })
    sendDelta("Here is ")
    sendDelta("the review.")
    expect(streamingText()).toBe("")

    // Any non-append event crosses the barrier and flushes the buffer; a tool
    // call is the boundary that occurs mid-turn.
    handleProviderEvent(THREAD, "tool_call", {
      tool_id: "tool-1",
      tool_name: "read_file",
    })
    expect(streamingText()).toBe("Here is the review.")
  })

  it("spills once the buffer grows past the cap", () => {
    useSettingsStore.setState({ enableAssistantStreaming: false })
    // 24_000 is the cap; one oversized delta must not sit invisible.
    sendDelta("x".repeat(24_001))
    runFrame()
    expect(streamingText().length).toBe(24_001)
  })

  it("keeps reasoning flowing even while the answer is held", () => {
    useSettingsStore.setState({ enableAssistantStreaming: false })
    sendDelta("answer text")
    handleProviderEvent(THREAD, "reasoning_delta", {
      delta: "thinking out loud",
    })
    runFrame()
    const stream =
      useChatStore.getState().streamingByThread[THREAD] ?? emptyStreamState
    expect(stream.reasoningText).toBe("thinking out loud")
    // The reasoning flush also drains the text buffer, which is fine — the
    // point is that reasoning is never withheld.
    expect(stream.streamingText).toBe("answer text")
  })
})
