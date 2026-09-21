import { useEffect, useRef } from "react"

/**
 * `setInterval` that automatically pauses when the window is hidden
 * (`document.visibilityState === "hidden"`) and resumes when it becomes
 * visible again. Electron fires visibilitychange on minimize, tab-switch in
 * fullscreen, OS lock screen, etc — so this keeps background CPU flat when
 * the user isn't looking.
 *
 * - `cb` runs every `intervalMs` while visible.
 * - If `enabled` is false, the interval is not armed at all.
 * - `cb` is re-read from the latest closure on each tick (ref-capture), so
 *   callers can pass an inline arrow without re-arming the timer every
 *   render. The interval-arming effect deliberately does NOT depend on `cb`.
 *
 * Typical use:
 *   useVisibilityInterval(refresh, 5000, { enabled: open && !!cwd })
 */
export function useVisibilityInterval(
  cb: () => void,
  intervalMs: number,
  opts: { enabled?: boolean; runOnVisible?: boolean } = {},
): void {
  const { enabled = true, runOnVisible = false } = opts

  const cbRef = useRef(cb)
  useEffect(() => {
    cbRef.current = cb
  })

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return

    let timer: ReturnType<typeof setInterval> | null = null

    const tick = () => cbRef.current()

    const start = () => {
      if (timer !== null) return
      timer = setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (runOnVisible) {
          try {
            cbRef.current()
          } catch {
            /* swallow — caller logs if needed */
          }
        }
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === "visible") {
      if (runOnVisible) {
        try {
          cbRef.current()
        } catch {
          /* swallow — caller logs if needed */
        }
      }
      start()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      stop()
    }
  }, [intervalMs, enabled, runOnVisible])
}
