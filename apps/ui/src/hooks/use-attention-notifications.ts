import { useEffect } from "react"

import { initAttentionWatcher } from "@/lib/attention-store"

/**
 * Mounts the app-wide attention watcher (badges for pending
 * approvals/questions/plan reviews). StrictMode-safe: the watcher is
 * idempotent and the effect cleanup unsubscribes.
 */
export function useAttentionNotifications() {
  useEffect(() => initAttentionWatcher(), [])
}
