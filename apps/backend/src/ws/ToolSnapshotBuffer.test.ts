import { afterEach, describe, expect, it, vi } from "vitest"
import { ToolSnapshotBuffer, toolSnapshotKey } from "./ToolSnapshotBuffer"

function update(tool: string, text: string, options: {
  thread?: string; turn?: string; provider?: string; cumulative?: boolean; activity?: boolean
} = {}) {
  const payload = {
    toolId: tool,
    output_delta: text,
    cumulative: options.cumulative ?? true,
    providerInstanceId: options.provider ?? "provider-1",
    turnId: options.turn ?? "turn-1",
  }
  return options.activity ? {
    channel: "thread.activity",
    data: { threadId: options.thread ?? "thread-1", kind: "tool.updated", payload },
  } : {
    channel: "provider.runtimeEvent",
    data: { thread_id: options.thread ?? "thread-1", event_type: "tool_call_delta", payload },
  }
}

const terminal = {
  channel: "provider.runtimeEvent",
  data: { thread_id: "thread-1", event_type: "turn_completed", payload: {} },
}

afterEach(() => vi.useRealTimers())

describe("live tool update coalescing", () => {
  it("flushes at shutdown and delivers final updates immediately without restarting timers", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new ToolSnapshotBuffer({ emit, onError: vi.fn() })
    buffer.offer(update("a", "pending"))
    buffer.drain()
    buffer.drain()
    buffer.offer(update("a", "shutdown output"))
    buffer.offer(terminal)
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual([
      update("a", "pending"), update("a", "shutdown output"), terminal,
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
  it("reduces a 1,000-snapshot two-channel burst to its two final snapshots before completion", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn() })
    for (let index = 0; index < 1_000; index++) {
      coalescer.offer(update("tool-1", `output-${index}`))
      coalescer.offer(update("tool-1", `output-${index}`, { activity: true }))
    }
    expect(emit).not.toHaveBeenCalled()
    coalescer.offer(terminal)
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual([
      update("tool-1", "output-999"),
      update("tool-1", "output-999", { activity: true }),
      terminal,
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps survivors in source order and does not let a busy tool starve the window", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn() })
    coalescer.offer(update("a", "old"))
    vi.advanceTimersByTime(25)
    coalescer.offer(update("b", "parallel"))
    coalescer.offer(update("a", "new"))
    vi.advanceTimersByTime(25)
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual([
      update("b", "parallel"), update("a", "new"),
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("retains incremental chunks, anonymous calls, and structural boundaries", () => {
    vi.useFakeTimers()
    const frames = [
      update("a", "snapshot"),
      update("a", "chunk 1", { cumulative: false }),
      update("a", "chunk 2", { cumulative: false }),
      update("", "anonymous 1"),
      update("", "anonymous 2"),
      { channel: "thread.activity", data: { kind: "approval.requested", payload: {} } },
      update("a", "next snapshot"),
      terminal,
    ]
    const emit = vi.fn()
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn() })
    frames.forEach((frame) => coalescer.offer(frame))
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual(frames)
  })

  it("retains a separate input patch even when the following output is cumulative", () => {
    vi.useFakeTimers()
    const initial = update("a", "first")
    const withInput = { ...initial, data: { ...initial.data, payload: {
      ...initial.data.payload, input: { command: "npm test" }, tool_name: "Bash",
    } } }
    const next = update("a", "first and second")
    const emit = vi.fn()
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn() })
    coalescer.offer(withInput)
    coalescer.offer(next)
    coalescer.flush()
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual([withInput, next])
  })

  it("separates the same tool id across threads, turns, providers, and channels", () => {
    vi.useFakeTimers()
    const frames = [
      update("a", "one"),
      update("a", "two", { thread: "thread-2" }),
      update("a", "three", { turn: "turn-2" }),
      update("a", "four", { provider: "provider-2" }),
      update("a", "five", { activity: true }),
    ]
    const emit = vi.fn()
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn() })
    frames.forEach((frame) => coalescer.offer(frame))
    coalescer.flush()
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual(frames)
    const activity = { channel: "thread.activity", data: {
      threadId: "thread-1", turnId: "outer-turn", providerInstanceId: "outer-provider",
      kind: "tool.updated", payload: { toolId: "a", cumulative: true },
    } }
    expect(toolSnapshotKey(activity)).toContain("outer-turn")
    expect(toolSnapshotKey(activity)).toContain("outer-provider")
  })

  it("flushes on the item limit without losing pending updates", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn(), maxItems: 2 })
    const frames = [update("a", "1"), update("b", "2"), update("c", "3")]
    frames.forEach((frame) => coalescer.offer(frame))
    expect(emit).toHaveBeenCalledTimes(2)
    coalescer.flush()
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual(frames)
  })

  it("bounds encoded bytes, releases replaced snapshots, and sends oversized frames immediately", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const a = update("a", "🌍".repeat(20))
    const bytes = Buffer.byteLength(JSON.stringify(a), "utf8")
    const coalescer = new ToolSnapshotBuffer({ emit, onError: vi.fn(), maxBytes: bytes })
    coalescer.offer(a)
    coalescer.offer(a)
    expect(emit).not.toHaveBeenCalled()
    const b = update("b", "🌍".repeat(20))
    coalescer.offer(b)
    expect(emit).toHaveBeenCalledExactlyOnceWith(a)
    const large = update("c", "🌍".repeat(100))
    coalescer.offer(large)
    expect(emit.mock.calls.map(([frame]) => frame)).toEqual([a, b, large])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not strand the remainder of a batch when one broadcast fails", () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const emit = vi.fn().mockImplementationOnce(() => { throw new Error("closed socket") })
    const coalescer = new ToolSnapshotBuffer({ emit, onError })
    coalescer.offer(update("a", "1"))
    coalescer.offer(update("b", "2"))
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
  })

  it("accepts the legacy ACP cumulative shape but never treats a label as a tool id", () => {
    const frame = { channel: "provider.runtimeEvent", data: {
      thread_id: "t", event_type: "tool_call_delta",
      payload: { tool_id: "id", detail: "full output", output_delta: "full output" },
    } }
    expect(toolSnapshotKey(frame)).not.toBeNull()
    expect(toolSnapshotKey({ ...frame, data: { ...frame.data, payload: {
      toolName: "Run command", detail: "full output", output_delta: "full output",
    } } })).toBeNull()
  })
})
