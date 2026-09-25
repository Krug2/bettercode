import { useEffect, useState } from "react"
import { decisionSettingsSchema, secretStateSchema, type DecisionSettings } from "@betterc0de/schema"
import { useSettingsStore, SETTINGS_UPDATED_EVENT } from "@/lib/settings-store"
import { getSettings } from "@/services/backend"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SettingsRow, SettingsSection } from "./atoms"

export function SettingsDecisionSection() {
  const saved = useSettingsStore(state => state.decisionLayer)
  const loaded = useSettingsStore(state => state.loaded)
  const [draft, setDraft] = useState(saved)
  const [key, setKey] = useState("")
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setDraft(saved), [saved])
  useEffect(() => {
    let active = true
    const refresh = () => void getSettings().then(settings => {
      if (active) setConfigured(secretStateSchema.optional().parse(settings.jev_api_key)?.configured ?? false)
    }).catch(() => { if (active) setError("Could not load the saved connection.") })
    refresh()
    window.addEventListener(SETTINGS_UPDATED_EVENT, refresh)
    return () => { active = false; window.removeEventListener(SETTINGS_UPDATED_EVENT, refresh) }
  }, [])
  async function save() {
    if (busy) return
    const parsed = decisionSettingsSchema.safeParse(draft)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the settings."); return }
    if (draft.mode === "jev" && !configured && !key.trim()) { setError("Add your TypeSafe key first."); return }
    if (draft.mode === "local" && !draft.localModel.trim()) { setError("Enter the model name served locally."); return }
    setBusy(true)
    setError(null)
    try {
      await useSettingsStore.getState().update({ decision_layer: parsed.data,
        ...(draft.mode !== "off" ? { orchestrator_enabled: true } : {}),
        ...(key.trim() ? { jev_api_key: { set: key.trim() } } : {}),
      })
      setKey("")
    } catch { setError("Could not save. Change these settings on the host computer.") }
    finally { setBusy(false) }
  }
  const field = <K extends keyof DecisionSettings>(name: K, value: DecisionSettings[K]) => setDraft(current => ({ ...current, [name]: value }))
  return <SettingsSection title="Decision layer" description="Fast, bounded choices alongside your main coding model, with a live decision stream.">
    <SettingsRow label="Selector" description="Your main model keeps reasoning and approvals. Pick the allowed workers under + → Orchestration in a chat.">
      <select aria-label="Decision selector" value={draft.mode} disabled={!loaded || busy}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm" onChange={event => field("mode", event.target.value as DecisionSettings["mode"])}>
        <option value="off">Normal harness</option><option value="jev">Jev</option><option value="local">Local model</option>
      </select>
    </SettingsRow>
    {draft.mode === "jev" && <div className="space-y-2 px-4 py-3">
      <label className="text-sm font-medium" htmlFor="decision-key">TypeSafe API key</label>
      <Input id="decision-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder={configured ? "Key saved. Leave blank to keep it." : "Enter your key"} disabled={busy} />
      <p className="text-xs text-muted-foreground">Shares your existing Jev connection. Task text, eligible model descriptions, and short shared-note excerpts go directly to TypeSafe. Keys are never returned to this screen.</p>
    </div>}
    {draft.mode === "local" && <div className="grid gap-3 px-4 py-3">
      <label className="space-y-1 text-sm">Local server URL<Input value={draft.localUrl} onChange={event => field("localUrl", event.target.value)} disabled={busy} /></label>
      <label className="space-y-1 text-sm">Model name<Input value={draft.localModel} placeholder="Installed model name" onChange={event => field("localModel", event.target.value)} disabled={busy} /></label>
      <p className="text-xs text-muted-foreground">Uses the local server's /v1 chat-completions API with JSON output. The server must already be running. Coding providers keep their own connections.</p>
    </div>}
    {draft.mode !== "off" && <details className="px-4 py-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Limits and fallback</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label>Timeout (ms)<Input type="number" min={250} max={10000} value={draft.timeoutMs} disabled={busy} onChange={event => field("timeoutMs", Number(event.target.value))} /></label>
        <label>Calls per turn<Input type="number" min={1} max={64} value={draft.maxCallsPerTurn} disabled={busy} onChange={event => field("maxCallsPerTurn", Number(event.target.value))} /></label>
        {draft.mode === "jev" && <label>Minimum confidence<Input type="number" min={0} max={1} step={0.05} value={draft.minConfidence} disabled={busy} onChange={event => field("minConfidence", Number(event.target.value))} /></label>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Timeouts, uncertainty, and unavailable models return control to the main model. Recovery choices are suggestions, never automatic command retries.</p>
    </details>}
    <div className="flex items-center gap-3 px-4 py-3">
      <Button size="sm" disabled={!loaded || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save decision settings"}</Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  </SettingsSection>
}
