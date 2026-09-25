import { useEffect, useMemo, useState } from "react"
import {
  decisionSnapshotSchema,
  emptyDecisionSnapshot,
  type DecisionSnapshot,
} from "@betterc0de/schema"
import { useChatStore } from "@/lib/chat-store"
import { invokeContract } from "@/services/backend/contracts"

export function newerDecisionSnapshot(
  current: DecisionSnapshot,
  incoming: DecisionSnapshot
): DecisionSnapshot {
  return current.threadId !== incoming.threadId ||
    incoming.revision >= current.revision
    ? incoming
    : current
}

export function useDecisions(threadId: string, connected: boolean) {
  const payload = useChatStore(
    (state) =>
      state.activitiesByThread[threadId]?.find(
        (activity) => activity.id === `decisions:${threadId}`
      )?.payload
  )
  const live = useMemo(
    () => decisionSnapshotSchema.safeParse(payload),
    [payload]
  )
  const [snapshot, setSnapshot] = useState(() =>
    emptyDecisionSnapshot(threadId)
  )
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (live.success && live.data.threadId === threadId) {
      setSnapshot((current) => newerDecisionSnapshot(current, live.data))
      setError(null)
    }
  }, [live, threadId])
  useEffect(() => {
    const controller = new AbortController()
    void invokeContract("orchestratorDecisions", {
      body: { threadId },
      signal: controller.signal,
      silentStatuses: [403],
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setSnapshot((current) => newerDecisionSnapshot(current, value))
          setError(null)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not sync decisions. Reconnect or retry.")
      })
    return () => controller.abort()
  }, [threadId, connected, refresh])
  return { snapshot, error, retry: () => setRefresh((value) => value + 1) }
}
