import { useCallback, useEffect, useRef, useState } from "react"
import type { UsageDashboard } from "@betterc0de/schema"
import { getUsageDashboard } from "@/services/backend/usageApi"

export function useUsage() {
  const [data, setData] = useState<UsageDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const inFlight = useRef(false)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    inFlight.current = true
    setLoading(true)
    void getUsageDashboard(controller.signal).then(value => {
      if (!controller.signal.aborted) { setData(value); setError(null) }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load usage")
    }).finally(() => { if (!controller.signal.aborted) { inFlight.current = false; setLoading(false) } })
    return () => { inFlight.current = false; controller.abort() }
  }, [revision])
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible" && !inFlight.current) refresh() }
    const timer = window.setInterval(update, 15_000)
    window.addEventListener("focus", update)
    return () => { clearInterval(timer); window.removeEventListener("focus", update) }
  }, [refresh])
  return { data, error, loading, refresh }
}
