import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Visual reconnection indicator shown below the titlebar / tab strip
 * when the WebSocket drops.
 *
 * States:
 *  - `wsReady === true` **and** was previously disconnected: flash
 *    "Connected" for 2 s, then fade out and unmount.
 *  - `wsReady === false`: show "Reconnecting..." with a pulsing dot.
 *  - `wsReady === true` from the start (never disconnected): render nothing.
 */
export function ConnectionStatus({ wsReady }: { wsReady: boolean }) {
  // Track whether we ever saw a disconnect so we can show the
  // "Connected" flash only after a real reconnection.
  const hadDisconnect = useRef(false)
  const [phase, setPhase] = useState<"hidden" | "disconnected" | "reconnected">(
    "hidden"
  )
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!wsReady) {
      hadDisconnect.current = true
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current)
        fadeTimer.current = null
      }
      setPhase("disconnected")
      return
    }

    // Connected — only flash if we previously lost the connection.
    if (hadDisconnect.current) {
      setPhase("reconnected")
      fadeTimer.current = setTimeout(() => {
        setPhase("hidden")
        fadeTimer.current = null
      }, 2000)
    }

    return () => {
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current)
        fadeTimer.current = null
      }
    }
  }, [wsReady])

  if (phase === "hidden") return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex shrink-0 items-center justify-center gap-2 border-b px-3 py-1.5 text-xs font-medium transition-all duration-500",
        phase === "disconnected" &&
          "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
        phase === "reconnected" &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 animate-in fade-in"
      )}
    >
      {phase === "disconnected" && (
        <>
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-yellow-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-yellow-400" />
          </span>
          Reconnecting...
        </>
      )}
      {phase === "reconnected" && (
        <>
          <span className="inline-flex size-2 rounded-full bg-emerald-400" />
          Connected
        </>
      )}
    </div>
  )
}
