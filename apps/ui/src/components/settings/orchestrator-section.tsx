import { useEffect, useRef, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { useSettingsStore } from "@/lib/settings-store"
import { SettingsRow, SettingsSection } from "./atoms"

export function SettingsOrchestratorSection() {
  const enabled = useSettingsStore((state) => state.orchestratorEnabled)
  const loaded = useSettingsStore((state) => state.loaded)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function toggle(value: boolean) {
    if (mutation.current) return
    mutation.current = true
    setBusy(true)
    setError(null)
    try {
      await useSettingsStore.getState().update({ orchestrator_enabled: value })
    } catch {
      if (mounted.current) setError("Could not save orchestration settings.")
    } finally {
      mutation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <SettingsSection
      title="Orchestration"
      description="Let the model in your chat delegate work to other providers."
    >
      <SettingsRow
        label="Experimental orchestration"
        description="The model selected in chat leads. Under + → Orchestration, enable other providers for its agents: Claude, OpenAI or Grok. It chooses their models and tasks."
      >
        <Switch
          aria-label="Enable orchestrator mode"
          checked={enabled}
          disabled={!loaded || busy}
          onCheckedChange={(value) => void toggle(value)}
        />
      </SettingsRow>
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Workers share the project and keep your normal approval requirements.
        Disabling this experiment stops workers and revokes their tools.
      </p>
      {error && (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
