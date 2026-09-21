import { useEffect, useRef, useState } from "react"
import { useVisibilityInterval } from "@/hooks/use-visibility-interval"
import { listLmStudioModels } from "@/services/backend/providersApi"

export type LmStudioModel = {
  id: string
  name: string
  context: string
  tier: string
}

// LM Studio's local server commonly listens on either 1234 (the default)
// or 1111, and on 127.0.0.1 vs localhost. Rather than probing the four
// combinations from the renderer (which hits CORS in some Electron
// configurations and races with the model picker open/close), we delegate
// to the backend's /lmstudio/models endpoint — it owns the multi-port
// probe and returns the discovered model list (or `error: not_running`).

/**
 * Polls the local LM Studio server for the list of models it's currently
 * serving. Returns the models as state.
 *
 * Only active when `lmStudioContextActive` is true (user selected LM
 * Studio or is browsing the model picker) — otherwise the hook is a
 * no-op.
 */
export function useLmStudioModels(lmStudioContextActive: boolean) {
  const [lmModels, setLmModels] = useState<LmStudioModel[]>([])
  useLmStudioModelsSync(lmStudioContextActive, setLmModels)
  return lmModels
}

/**
 * Variant of {@link useLmStudioModels} for callers that already own the
 * `lmModels` state (e.g. because the state needs to be declared earlier
 * in the component body for ordering reasons). Pass the setter in and
 * this hook just manages the polling.
 */
export function useLmStudioModelsSync(
  lmStudioContextActive: boolean,
  setLmModels: React.Dispatch<React.SetStateAction<LmStudioModel[]>>
) {
  // Track the latest "active" flag so an in-flight fetch that completes
  // after the user toggles LM Studio off doesn't stamp stale models back
  // onto state. Replaces the prior effect-scoped `cancelled` flag now that
  // the timer is owned by useVisibilityInterval.
  const activeRef = useRef(lmStudioContextActive)
  useEffect(() => {
    activeRef.current = lmStudioContextActive
  }, [lmStudioContextActive])

  useVisibilityInterval(
    async () => {
      try {
        const result = await listLmStudioModels()
        if (!activeRef.current) return
        if (result.error || !result.data) {
          setLmModels([])
          return
        }
        setLmModels(
          result.data.map((m) => ({
            id: m.id,
            name: m.id.split("/").pop() || m.id,
            context: "Local",
            tier: "Local",
          }))
        )
      } catch {
        if (activeRef.current) setLmModels([])
      }
    },
    120000,
    { enabled: lmStudioContextActive, runOnVisible: true },
  )
}
