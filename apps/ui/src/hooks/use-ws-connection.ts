import { useEffect, useRef } from "react"
import { connectWs, getWsPort, type WsEventHandler } from "@/services/backend"

/**
 * Establishes the app's persistent WebSocket connection to the backend
 * and keeps it alive across reconnects.
 *
 * Behavior:
 *  - Waits up to 5s for `window.__BETTERC0DE__` to be injected by
 *    Electron, then resolves the port.
 *  - Connects via `connectWs`; on success, stores the socket on
 *    `wsRef.current` and flips `setWsReady(true)`.
 *  - On socket close (not user-initiated), schedules an exponential-
 *    backoff reconnect — capped at 30s with a small jitter, bounded to
 *    2^6 * 1s base delay.
 *  - Cleanup on unmount cancels any pending reconnect and closes the
 *    current socket so stale sockets can't emit events into a torn-down
 *    component tree.
 *
 * The `onEvent` prop is the ws message handler — the hook intentionally
 * doesn't know *what* the events mean, only how to route them. The
 * callback is re-latched on every render; the effect re-creates on
 * `depKey` changes which should be a stable value the caller
 * increments only when it really wants to reconnect.
 */
export function useWsConnection({
  wsRef,
  setWsReady,
  onEvent,
  depKey,
}: {
  wsRef: React.MutableRefObject<WebSocket | null>
  setWsReady: (ready: boolean) => void
  onEvent: WsEventHandler
  depKey?: unknown
}) {
  const callbacks = useRef({ onEvent, setWsReady })
  useEffect(() => {
    callbacks.current = { onEvent, setWsReady }
  })
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return
      const cappedAttempt = Math.min(reconnectAttempt, 6)
      const baseDelay = 1000 * 2 ** cappedAttempt
      const jitter = Math.floor(Math.random() * 300)
      const delay = Math.min(baseDelay + jitter, 30000)
      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, delay)
    }

    /**
     * The port is resolved per attempt rather than captured once. Before this,
     * an attempt made while the backend was still booting locked onto the
     * hardcoded fallback port and every retry redialled it forever; the same
     * applied after a backend restart moved the port.
     */
    const connect = async () => {
      if (cancelled) return
      try {
        const port = await getWsPort()
        if (cancelled) return
        let connectedWs: WebSocket | null = null
        const handleClose = () => {
          if (cancelled) return
          if (connectedWs && wsRef.current === connectedWs) wsRef.current = null
          callbacks.current.setWsReady(false)
          scheduleReconnect()
        }
        const nextWs = await connectWs(
          port,
          undefined,
          (event) => {
            if (!cancelled) callbacks.current.onEvent(event)
          },
          undefined,
          handleClose,
          controller.signal
        )
        connectedWs = nextWs
        if (cancelled) {
          nextWs.close()
          return
        }
        reconnectAttempt = 0
        clearReconnectTimer()
        wsRef.current = nextWs
        callbacks.current.setWsReady(true)
      } catch {
        if (cancelled) return
        callbacks.current.setWsReady(false)
        scheduleReconnect()
      }
    }

    // Wait for __BETTERC0DE__ config to be injected by Electron. The poll must
    // be cancellable: without tracking these timers the recursive `check`
    // re-armed every 200ms forever — past the 5s resolve and past unmount.
    let configPollTimer: ReturnType<typeof setTimeout> | null = null
    let configMaxWaitTimer: ReturnType<typeof setTimeout> | null = null
    const clearConfigTimers = () => {
      if (configPollTimer) clearTimeout(configPollTimer)
      if (configMaxWaitTimer) clearTimeout(configMaxWaitTimer)
      configPollTimer = null
      configMaxWaitTimer = null
    }
    const waitForConfig = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearConfigTimers()
          resolve()
        }
        const check = () => {
          if (cancelled || window.__BETTERC0DE__?.port) {
            finish()
            return
          }
          configPollTimer = setTimeout(check, 200)
        }
        check()
        configMaxWaitTimer = setTimeout(finish, 5000) // max 5s wait
      })
    waitForConfig()
      .then(() => {
        if (cancelled) return
        void connect()
      })
      .catch(() => {
        console.warn("Failed to establish WebSocket connection to backend")
      })
    return () => {
      cancelled = true
      controller.abort()
      clearReconnectTimer()
      clearConfigTimers()
      wsRef.current = null
      // Abort also closes sockets still waiting for auth_ok.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey])
}
