import { RemoteSocket } from "@/lib/remote-socket"
import { isReplayGapFrame } from "@/lib/runtime-events"
import { useAppStore } from "@/store/app-store"
import { useSessionStore } from "@/store/session-store"
import { useEffect, useRef } from "react"
import { AppState } from "react-native"

export function AppRuntime() {
  const profile = useSessionStore((state) => state.profile)
  const hydrate = useSessionStore((state) => state.hydrate)
  const check = useSessionStore((state) => state.check)
  const setSocketState = useSessionStore((state) => state.setSocketState)
  const socketRef = useRef<RemoteSocket | null>(null)
  const connectionKey = profile
    ? `${profile.baseUrl}\u0000${profile.environmentId}\u0000${profile.sessionToken}`
    : null

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!profile) {
      socketRef.current?.stop()
      socketRef.current = null
      useAppStore.getState().reset()
      return
    }

    const pendingRefreshes = new Set<ReturnType<typeof setTimeout>>()
    const app = useAppStore.getState()
    void Promise.allSettled([
      app.refreshThreads(profile),
      app.refreshProjects(profile),
    ])
    const socket = new RemoteSocket(profile, {
      onState: setSocketState,
      // The host refused our token. `check()` clears the pairing when the
      // session is really gone; if the host still accepts it (a race with
      // a token rotation) the socket is told to try again by hand.
      onUnauthorized: () => {
        void check().then((stillPaired) => {
          if (stillPaired && socketRef.current === socket) socket.reconnectNow()
        })
      },
      onFrame: (frame) => {
        if (isReplayGapFrame(frame)) {
          void reconcileHydratedState(profile)
          return
        }
        const outcome = useAppStore.getState().applyFrame(frame)
        if (!outcome) return
        if (outcome.terminal) {
          const timer = setTimeout(() => {
            pendingRefreshes.delete(timer)
            const store = useAppStore.getState()
            void Promise.allSettled([
              store.loadMessages(profile, outcome.threadId, true),
              store.loadActivities(profile, outcome.threadId),
              store.refreshThreads(profile),
            ])
          }, 180)
          pendingRefreshes.add(timer)
        } else if (outcome.refreshThreads) {
          void useAppStore
            .getState()
            .refreshThreads(profile)
            .catch(() => undefined)
        }
      },
    })
    socketRef.current = socket
    socket.start()

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return
      socket.reconnectNow()
      void check()
    })
    const healthTimer = setInterval(() => {
      if (AppState.currentState === "active") void check()
    }, 60_000)

    return () => {
      for (const timer of pendingRefreshes) clearTimeout(timer)
      clearInterval(healthTimer)
      subscription.remove()
      socket.stop()
      if (socketRef.current === socket) socketRef.current = null
    }
    // Session metadata (for example lastSeenAt) may refresh without changing
    // the actual connection. Keep the socket alive until endpoint or token do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, connectionKey, setSocketState])

  return null
}

async function reconcileHydratedState(
  profile: NonNullable<ReturnType<typeof useSessionStore.getState>["profile"]>
): Promise<void> {
  const store = useAppStore.getState()
  const hydratedThreadIds = new Set([
    ...Object.keys(store.messagesByThread),
    ...Object.keys(store.activitiesByThread),
    ...Object.keys(store.requestsByThread),
  ])
  await Promise.allSettled([
    store.refreshThreads(profile),
    store.refreshProjects(profile),
    ...[...hydratedThreadIds].flatMap((threadId) => [
      store.loadMessages(profile, threadId, true),
      store.loadActivities(profile, threadId),
    ]),
  ])
  // The gap may have swallowed a turn's terminal event. The thread list is
  // the host's view of what still runs; a stream it does not know about
  // would otherwise spin forever.
  const after = useAppStore.getState()
  for (const [threadId, stream] of Object.entries(after.streamsByThread)) {
    if (!stream.running) continue
    const thread = after.threads.find((item) => item.id === threadId)
    if (thread && !thread.session?.activeTurnId) after.clearStream(threadId)
  }
}
