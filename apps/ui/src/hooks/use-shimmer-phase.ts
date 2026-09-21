import { useEffect, useState } from "react"

/**
 * Returns a phase index (0→4) that advances while the assistant is
 * streaming but hasn't produced any visible content yet.
 *
 * Used by `<StreamingMessage>` to change its waiting label after a delay.
 * The animation is driven by the activity, never by this timer.
 * Resets to 0 the moment reasoning, tool calls, or
 * text actually start flowing.
 *
 * Thresholds: 3s → phase 1, 7s → 2, 12s → 3, 18s → 4. Tuned empirically
 * against Claude's "warmup" latency — most turns show content before
 * phase 2.
 */
export function useShimmerPhase({
  isStreaming,
  hasStreamingContent,
}: {
  isStreaming: boolean
  hasStreamingContent: boolean
}) {
  const active = isStreaming && !hasStreamingContent
  // [FIX] react-hooks/set-state-in-effect — the original code called
  // `setShimmerPhase(0)` synchronously inside the effect body, which
  // cascades renders. We now only setState asynchronously from timers,
  // and gate the returned value on `active` so the consumer sees 0 the
  // instant streaming stops regardless of the internal counter.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const t1 = setTimeout(() => setTick(1), 3000)
    const t2 = setTimeout(() => setTick(2), 7000)
    const thirdTimer = setTimeout(() => setTick(3), 12000)
    const t4 = setTimeout(() => setTick(4), 18000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(thirdTimer)
      clearTimeout(t4)
      // Reset so the next active session starts at phase 0. This runs in
      // the cleanup path (i.e., not during the effect body), so it does
      // not trigger the react-hooks/set-state-in-effect rule.
      setTick(0)
    }
  }, [active])
  return active ? tick : 0
}
