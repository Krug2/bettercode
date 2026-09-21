/**
 * Streaming text: frame-coalesced delta delivery, the hidden-window
 * backstop timer, the buffered-assistant hold, and `<proposed_plan>` capture
 * at the start of a turn.
 */

import {
  useChatStore,
  emptyStreamState,
} from "@/lib/chat-store"
import { useSettingsStore } from "@/lib/settings-store"
import { backendOwnedFinalizeOptions } from "./payload"

const proposedPlanOpenTag = "<proposed_plan>"

const contentPlanCaptureByThread = new Map<
  string,
  { mode: "pending" | "plan" | "normal"; buffer: string }
>()

export function readTextDelta(payload: Record<string, unknown>): string {
  return typeof payload.delta === "string"
    ? payload.delta
    : typeof payload.textDelta === "string"
      ? payload.textDelta
      : ""
}

export function traceProviderEventsEnabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("betterc0de:trace-provider-events") === "1"
    )
  } catch {
    return false
  }
}

function markPlanCapturePending(threadId: string) {
  useChatStore.setState((state) => {
    const cur = state.streamingByThread[threadId] ?? emptyStreamState
    return {
      streamingByThread: {
        ...state.streamingByThread,
        [threadId]: {
          ...cur,
          isStreaming: true,
          isReasoning: false,
        },
      },
    }
  })
}

function proposedPlanPrefixState(text: string): "pending" | "plan" | "normal" {
  const trimmed = text.trimStart().toLowerCase()
  if (!trimmed) return "pending"
  if (proposedPlanOpenTag.startsWith(trimmed)) return "pending"
  if (trimmed.startsWith(proposedPlanOpenTag)) return "plan"
  return "normal"
}

// ── Streaming delta coalescing ──────────────────────────────────────────────
//
// Each of `appendStreamDelta` / `appendPlanStreamDelta` / `appendReasoningDelta`
// runs a zustand `set()`, which rebuilds `streamingByThread` and the thread's
// stream object. At one call per token, with several threads streaming at once,
// that allocation is the dominant renderer cost — and every one of those
// snapshots is thrown away before a frame is painted.
//
// Deltas are therefore accumulated per thread and applied once per animation
// frame. The visible result is identical (the UI paints at frame rate either
// way); only the discarded intermediate snapshots go away.
//
// Ordering rules that keep this safe:
//   * Only *appends* are buffered. Any other store write for a thread flushes
//     that thread first (see `flushPendingDeltas` calls below).
//   * Within a frame a thread accumulates either text or plan, never both:
//     `appendAssistantContentDelta` routes to exactly one per capture mode,
//     and a mode change goes through `replacePlanStreamText`, which flushes.
//   * Without `requestAnimationFrame` (tests, SSR) deltas apply synchronously,
//     so existing behaviour and test expectations are unchanged.

type DeltaKind = "text" | "plan" | "reasoning"

interface PendingDeltaBuffer {
  parts: { kind: DeltaKind; delta: string }[]
  textChars: number
}

const pendingDeltasByThread = new Map<string, PendingDeltaBuffer>()

let pendingDeltaFrame: number | null = null

let pendingDeltaTimer: ReturnType<typeof setTimeout> | null = null
/** Backstop cadence when frames are not being delivered (hidden window). */

const HIDDEN_WINDOW_FLUSH_MS = 100

/**
 * Event types whose handling is a pure append into the coalescer. Every other
 * type flushes the thread's buffer first — see the barrier in
 * `handleProviderEvent`.
 */
export const COALESCED_DELTA_EVENT_TYPES: ReadonlySet<string> = new Set([
  "content_delta",
  "reasoning_delta",
  "turn.proposed.delta",
])

function canCoalesceDeltas(): boolean {
  return typeof requestAnimationFrame === "function"
}

/**
 * Frames are the preferred clock, but they are NOT a guaranteed one:
 * `requestAnimationFrame` is paused entirely while a window is minimized,
 * occluded, or in a background workspace. Relying on it alone meant a chat
 * streaming into a backgrounded window buffered tokens that never rendered —
 * the transcript sat frozen until some non-delta event happened to hit the
 * barrier. A timer runs alongside it so progress never depends on the window
 * being visible; whichever fires first flushes and cancels the other.
 */
function scheduleDeltaFlush(): void {
  if (pendingDeltaFrame !== null || pendingDeltaTimer !== null) return
  const flush = () => {
    clearScheduledFlush()
    flushPendingDeltas()
  }
  pendingDeltaFrame = requestAnimationFrame(flush)
  pendingDeltaTimer = setTimeout(flush, HIDDEN_WINDOW_FLUSH_MS)
}

function clearScheduledFlush(): void {
  if (pendingDeltaFrame !== null) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(pendingDeltaFrame)
    }
    pendingDeltaFrame = null
  }
  if (pendingDeltaTimer !== null) {
    clearTimeout(pendingDeltaTimer)
    pendingDeltaTimer = null
  }
}

/**
 * How much buffered answer text may accumulate before it is spilled even
 * though no boundary has been reached. Without a cap a very long answer would
 * sit invisible for minutes and then land in one enormous re-render.
 */
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000

/**
 * With assistant streaming switched off the answer is delivered whole instead
 * of token by token: text deltas are accumulated and released at the next
 * interaction boundary — a tool call, an approval request, or the end of the
 * turn — all of which already flush through the barrier in
 * `handleProviderEvent`. Reasoning and plan deltas keep streaming either way,
 * so the user still watches the agent work; only the finished answer arrives
 * in one piece.
 */
function shouldHoldAssistantText(bufferedChars: number): boolean {
  if (bufferedChars >= MAX_BUFFERED_ASSISTANT_CHARS) return false
  try {
    return useSettingsStore.getState().enableAssistantStreaming === false
  } catch {
    return false
  }
}

export function queueDelta(
  threadId: string,
  kind: DeltaKind,
  delta: string
): void {
  const store = useChatStore.getState()
  // An empty delta is a signal ("streaming started"), not content — applying it
  // immediately keeps `isStreaming` responsive.
  if (!delta || !canCoalesceDeltas()) {
    flushPendingDeltas(threadId)
    applyDelta(store, threadId, kind, delta)
    return
  }
  const buffer = pendingDeltasByThread.get(threadId) ?? {
    parts: [],
    textChars: 0,
  }
  // Only adjacent chunks share a write: regrouping by kind can turn
  // think → answer into answer → think and reopen a finished phase.
  const last = buffer.parts.at(-1)
  if (last?.kind === kind) last.delta += delta
  else buffer.parts.push({ kind, delta })
  if (kind === "text") buffer.textChars += delta.length
  pendingDeltasByThread.set(threadId, buffer)
  if (kind === "text" && shouldHoldAssistantText(buffer.textChars)) return
  scheduleDeltaFlush()
}

function applyDelta(
  store: ReturnType<typeof useChatStore.getState>,
  threadId: string,
  kind: DeltaKind,
  delta: string
): void {
  if (kind === "text") store.appendStreamDelta(threadId, delta)
  else if (kind === "plan") store.appendPlanStreamDelta(threadId, delta)
  else store.appendReasoningDelta(threadId, delta)
}

/**
 * Apply buffered deltas now. Called before any non-append store write for a
 * thread so a pending buffer can never be observed out of order, and exported
 * so callers that need a hard barrier before reading stream state can force one.
 */
export function flushPendingDeltas(threadId?: string): void {
  const store = useChatStore.getState()
  const targets =
    threadId === undefined ? [...pendingDeltasByThread.keys()] : [threadId]
  for (const target of targets) {
    const buffer = pendingDeltasByThread.get(target)
    if (!buffer) continue
    pendingDeltasByThread.delete(target)
    for (const part of buffer.parts) {
      applyDelta(store, target, part.kind, part.delta)
    }
  }
  // Release the scheduled slots once nothing is outstanding. Without this, a
  // barrier flush that drains the map leaves the handles set until the
  // already-scheduled callbacks fire; if they are never delivered (window torn
  // down, test harness swapping rAF), `scheduleDeltaFlush` keeps
  // short-circuiting and later deltas sit in the buffer forever.
  if (pendingDeltasByThread.size === 0) clearScheduledFlush()
}

export function appendAssistantContentDelta(threadId: string, delta: string) {
  const capture = contentPlanCaptureByThread.get(threadId)

  if (capture?.mode === "plan") {
    const buffer = capture.buffer + delta
    contentPlanCaptureByThread.set(threadId, { mode: "plan", buffer })
    queueDelta(threadId, "plan", delta)
    return
  }

  if (capture?.mode === "normal") {
    queueDelta(threadId, "text", delta)
    return
  }

  const buffer = (capture?.buffer ?? "") + delta
  const state = proposedPlanPrefixState(buffer)

  if (state === "pending") {
    contentPlanCaptureByThread.set(threadId, { mode: "pending", buffer })
    markPlanCapturePending(threadId)
    return
  }

  if (state === "plan") {
    contentPlanCaptureByThread.set(threadId, { mode: "plan", buffer })
    // Replaces rather than appends — buffered appends must land first.
    flushPendingDeltas(threadId)
    useChatStore.getState().replacePlanStreamText(threadId, buffer)
    return
  }

  contentPlanCaptureByThread.set(threadId, { mode: "normal", buffer: "" })
  queueDelta(threadId, "text", buffer)
}

export function clearContentPlanCapture(threadId: string) {
  contentPlanCaptureByThread.delete(threadId)
}

/**
 * Text held back while it still might be the opening of a `<proposed_plan>`
 * tag. At a turn boundary the decision is forced: it was ordinary text.
 */
export function pendingPlanCaptureText(threadId: string): string | null {
  const capture = contentPlanCaptureByThread.get(threadId)
  return capture?.mode === "pending" && capture.buffer ? capture.buffer : null
}

export function finalizeAssistantTextAtInteractionBoundary(threadId: string) {
  const stream = useChatStore.getState().streamingByThread[threadId]
  if (!stream || stream.isPlanStreaming) return
  if (stream.streamingText.trim().length === 0) {
    const hasVisibleNonTextWork =
      stream.reasoningText.trim().length > 0 ||
      stream.streamingTools.length > 0 ||
      stream.streamingTasks.length > 0 ||
      stream.streamingDiffs.length > 0
    if (!hasVisibleNonTextWork) {
      clearContentPlanCapture(threadId)
      // A pending interaction still owns its provider turn.
      useChatStore.setState((state) => ({
        streamingByThread: {
          ...state.streamingByThread,
          [threadId]: { ...stream, streamingText: "" },
        },
      }))
    }
    return
  }
  clearContentPlanCapture(threadId)
  useChatStore
    .getState()
    .finalizeStream(
      threadId,
      {
        ...backendOwnedFinalizeOptions(threadId, stream.activeTurnId, true),
        keepTurnActive: true,
      }
    )
}
