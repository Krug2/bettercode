import { beforeEach, describe, expect, it } from "vitest"
import { useChatStore } from "@/lib/chat-store"
import { emptyStreamState } from "@/lib/chat/types"

const THREAD = "thread-reasoning"

function stream() {
  return useChatStore.getState().streamingByThread[THREAD] ?? emptyStreamState
}

beforeEach(() => {
  useChatStore.setState({ streamingByThread: {} })
})

/**
 * A long turn thinks, acts, then thinks again. Each stretch has to become its
 * own stored segment so grouping the UI never overwrites earlier reasoning.
 */
describe("reasoning segmentation", () => {
  it("keeps thinking in the live buffer until a boundary", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "Let me check ")
    store.appendReasoningDelta(THREAD, "the diff.")

    expect(stream().reasoningText).toBe("Let me check the diff.")
    expect(stream().isReasoning).toBe(true)
    expect(stream().reasoningSegments).toEqual([])
  })

  it("seals the stretch when the agent runs a tool", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "First I read the diff.")
    store.addToolCall(THREAD, { id: "tool-1", name: "read_file", input: {}, state: "input-available" })

    expect(stream().reasoningSegments).toHaveLength(1)
    expect(stream().reasoningSegments[0]?.text).toBe("First I read the diff.")
    // The live buffer is empty again, ready for the next stretch.
    expect(stream().reasoningText).toBe("")
    expect(stream().isReasoning).toBe(false)
  })

  it("seals the stretch when the agent starts answering", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "I have enough to answer.")
    store.appendStreamDelta(THREAD, "Here is the review:")

    expect(stream().reasoningSegments).toHaveLength(1)
    expect(stream().reasoningSegments[0]?.text).toBe(
      "I have enough to answer."
    )
    expect(stream().reasoningText).toBe("")
    expect(stream().streamingText).toBe("Here is the review:")
  })

  it("preserves each stretch across a think → act → think turn", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "Read the diff first.")
    store.addToolCall(THREAD, { id: "tool-1", name: "read_file", input: {}, state: "input-available" })
    store.appendReasoningDelta(THREAD, "Now check the tests.")
    store.addToolCall(THREAD, { id: "tool-2", name: "bash", input: {}, state: "input-available" })
    store.appendReasoningDelta(THREAD, "Ready to write it up.")

    expect(stream().reasoningSegments.map((s) => s.text)).toEqual([
      "Read the diff first.",
      "Now check the tests.",
    ])
    // The third stretch is still live and joins the same disclosure in the UI.
    expect(stream().reasoningText).toBe("Ready to write it up.")
  })

  it("does not create empty blocks at boundaries without thinking", () => {
    const store = useChatStore.getState()
    store.addToolCall(THREAD, { id: "tool-1", name: "read_file", input: {}, state: "input-available" })
    store.appendStreamDelta(THREAD, "Answer.")
    store.closeReasoningSegment(THREAD)

    expect(stream().reasoningSegments).toEqual([])
  })

  it("ignores whitespace-only thinking", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "   \n  ")
    store.addToolCall(THREAD, { id: "tool-1", name: "read_file", input: {}, state: "input-available" })

    expect(stream().reasoningSegments).toEqual([])
    expect(stream().isReasoning).toBe(false)
    expect(stream().reasoningText).toBe("")
  })

  it.each(["appendPlanStreamDelta", "replacePlanStreamText"] as const)("ends thinking when %s starts a plan", (action) => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "Plan the work.")
    store[action](THREAD, "# Plan")
    expect(stream().isReasoning).toBe(false)
    expect(stream().reasoningText).toBe("")
    expect(stream().reasoningSegments.map((segment) => segment.text)).toEqual(["Plan the work."])
  })

  it("records when each stretch started and ended", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "Thinking.")
    store.addToolCall(THREAD, { id: "tool-1", name: "read_file", input: {}, state: "input-available" })

    const segment = stream().reasoningSegments[0]
    expect(typeof segment?.startedAt).toBe("number")
    expect(typeof segment?.endedAt).toBe("number")
    expect(segment!.endedAt!).toBeGreaterThanOrEqual(segment!.startedAt!)
  })

  it("gives each block a distinct key", () => {
    const store = useChatStore.getState()
    store.appendReasoningDelta(THREAD, "One.")
    store.addToolCall(THREAD, { id: "tool-1", name: "read_file", input: {}, state: "input-available" })
    store.appendReasoningDelta(THREAD, "Two.")
    store.addToolCall(THREAD, { id: "tool-2", name: "bash", input: {}, state: "input-available" })

    const ids = stream().reasoningSegments.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
