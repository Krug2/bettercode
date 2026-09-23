import { useCallback, useEffect, useState } from "react"
import { Copy, Link2, LoaderCircle, Monitor, RefreshCw, ShieldCheck } from "lucide-react"
import { SettingsRow, SettingsSection } from "./atoms"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { copyText } from "@/lib/clipboard"
import { isRemoteRuntime } from "@/services/backend/runtime"
import {
  approveDevice, cancelDeviceLink, forgetDevice, getDevices, inviteDevice, linkDevice, openDevice, revokeDevice, saveDeviceSettings,
  type DeviceApproval, type DevicePermission, type DeviceStatus,
} from "@/services/backend/deviceApi"

function PendingDevice({ request, disabled, approve }: { request: DeviceApproval; disabled: boolean; approve(permission?: DevicePermission): void }) {
  const [accessLevel, setAccessLevel] = useState<DevicePermission["accessLevel"]>("read_only")
  const [allowTerminal, setAllowTerminal] = useState(false)
  return <div className="space-y-3 p-4">
    <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" />{request.label}</p>
    <p className="text-sm text-muted-foreground">check that this code matches the other computer before approving.</p>
    <p className="rounded-lg bg-muted p-3 font-mono text-lg tracking-wider">{request.code}</p>
    <label className="flex items-center justify-between gap-3 text-sm">access
      <select aria-label={`access for ${request.label}`} className="rounded-md border bg-background px-3 py-2" value={accessLevel} onChange={e => setAccessLevel(e.target.value as DevicePermission["accessLevel"])}>
        <option value="read_only">read only</option><option value="full">full control</option>
      </select>
    </label>
    <label className="flex items-center justify-between gap-3 text-sm">allow terminal
      <Switch aria-label={`allow terminal for ${request.label}`} checked={allowTerminal && accessLevel === "full"} disabled={accessLevel !== "full"} onCheckedChange={setAllowTerminal} />
    </label>
    {allowTerminal && accessLevel === "full" && <p className="text-xs text-muted-foreground">also enable terminal access in remote access settings.</p>}
    <div className="flex gap-2">
      <Button disabled={disabled} onClick={() => approve({ accessLevel, allowTerminal })}>approve</Button>
      <Button variant="outline" disabled={disabled} onClick={() => approve()}>decline</Button>
    </div>
  </div>
}

export function SettingsDevicesSection() {
  const remote = isRemoteRuntime()
  const [status, setStatus] = useState<DeviceStatus>()
  const [draft, setDraft] = useState<{ label: string; relayUrl: string; enabled: boolean }>()
  const [error, setError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)
  const [invitation, setInvitation] = useState<{ code: string; expiresAt: string }>()
  const [code, setCode] = useState("")
  const [copied, setCopied] = useState(false)
  const refresh = useCallback(async () => {
    const value = await getDevices()
    setStatus(value)
    setDraft(previous => previous ?? { label: value.label, relayUrl: value.relayUrl, enabled: value.enabled })
  }, [])
  useEffect(() => {
    if (remote) return
    let active = true
    let running = false
    const update = async () => {
      if (running) return
      running = true
      try {
        const value = await getDevices()
        if (active) {
          setLoadError("")
          setStatus(value)
          setDraft(previous => previous ?? { label: value.label, relayUrl: value.relayUrl, enabled: value.enabled })
        }
      } catch (reason) { if (active) setLoadError(reason instanceof Error ? reason.message : "could not load devices") }
      finally { running = false }
    }
    void update()
    const interval = setInterval(() => { void update() }, 2000)
    return () => { active = false; clearInterval(interval) }
  }, [remote])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    try { await action(); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : "device action failed") }
    finally { setBusy(false) }
  }
  if (remote) return <p className="text-sm text-muted-foreground">manage linked computers in the local desktop app.</p>
  return <>
    {(error || loadError) && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error || loadError}</p>}
    {!status || !draft ? <Button variant="ghost" onClick={() => void run(refresh)} disabled={busy}><RefreshCw className="size-4" />load devices</Button> : <>
      {!status.persistent && <p className="rounded-lg border p-3 text-sm text-muted-foreground">secure storage is unavailable. device links on this computer last until the app closes.</p>}
      <SettingsSection title="this computer" description="share this computer through your relay. both computers connect outward, so they can be on different networks.">
        <SettingsRow label="device name"><Input aria-label="device name" className="max-w-xs" maxLength={80} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></SettingsRow>
        <SettingsRow label="receive device connections"><Switch aria-label="receive device connections" checked={draft.enabled} onCheckedChange={enabled => setDraft({ ...draft, enabled })} /></SettingsRow>
        <div className="space-y-3 p-4">
          <label className="space-y-2 text-sm"><span>relay address</span><Input aria-label="relay address" placeholder="https://relay.example.com" maxLength={2048} value={draft.relayUrl} onChange={e => setDraft({ ...draft, relayUrl: e.target.value })} /></label>
          <div className="flex items-center justify-between gap-3"><span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${status.state === "online" ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />{status.state}</span>
            <Button disabled={busy || !draft.label.trim()} onClick={() => void run(() => saveDeviceSettings(draft))}>save</Button></div>
          {status.error && <p className="text-sm text-destructive">{status.error}</p>}
          <p className="text-xs text-muted-foreground">use your self-hosted relay address. no public relay is configured by default.</p>
        </div>
      </SettingsSection>
      <SettingsSection title="invite another computer" description="create an invitation here, then paste it into devices on the other computer. approve the matching code on this computer.">
        <div className="space-y-3 p-4">
          <Button disabled={busy || status.state !== "online"} onClick={() => void run(async () => { setInvitation(await inviteDevice()); setCopied(false) })}><Link2 className="size-4" />create invitation</Button>
          {invitation && <>
            <textarea aria-label="device invitation" className="w-full resize-none rounded-lg border bg-muted/40 p-3 font-mono text-xs" rows={3} readOnly value={invitation.code} />
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">expires at {new Date(invitation.expiresAt).toLocaleTimeString()}</span>
              <Button variant="outline" onClick={() => void run(async () => { if (!await copyText(invitation.code)) throw new Error("could not copy invitation"); setCopied(true) })}><Copy className="size-4" />{copied ? "copied" : "copy"}</Button></div>
          </>}
        </div>
      </SettingsSection>
      {status.pending.length > 0 && <SettingsSection title="waiting for your approval">{status.pending.map(request => <PendingDevice key={request.id} request={request} disabled={busy} approve={permission => void run(() => approveDevice(request.id, permission))} />)}</SettingsSection>}
      <SettingsSection title="connect to another computer" description="paste an invitation from the computer that will run your agents. it must be awake with the app running.">
        <div className="space-y-3 p-4">
          <textarea aria-label="paste device invitation" className="w-full resize-none rounded-lg border bg-background p-3 text-sm" placeholder="bettercode-device:..." value={code} maxLength={16_384} rows={3} onChange={e => setCode(e.target.value)} />
          <Button disabled={busy || !code.trim()} onClick={() => void run(async () => { await linkDevice(code.trim()); setCode("") })}>link computer</Button>
          {status.links.map(link => <div key={link.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <p>{link.label}: {link.status}</p>
            {link.status === "waiting" && <><p className="font-mono tracking-wider">{link.code}</p><p className="text-muted-foreground">approve this code on the other computer.</p></>}
            {link.error && <p className="text-destructive">{link.error}</p>}
            {["connecting", "waiting"].includes(link.status) && <Button variant="outline" size="sm" onClick={() => void run(() => cancelDeviceLink(link.id))}>cancel</Button>}
          </div>)}
        </div>
      </SettingsSection>
      <SettingsSection title="linked computers" description="each computer opens in its own window with its own chats, projects, and files.">
        {status.hosts.length === 0 ? <p className="p-4 text-sm text-muted-foreground">no computers linked yet.</p> : status.hosts.map(host => <div key={host.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1"><p className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4" />{host.label}</p>
            <p className="text-xs text-muted-foreground">{host.state} · {host.accessLevel === "full" ? "full control" : "read only"} · expires {new Date(host.expiresAt).toLocaleDateString()}</p>
            {host.error && <p className="text-xs text-destructive">{host.error}</p>}</div>
          <div className="flex gap-2"><Button disabled={busy} onClick={() => void run(() => openDevice(host.id))}>open</Button><Button variant="outline" disabled={busy} onClick={() => void run(() => forgetDevice(host.id))}>forget</Button></div>
        </div>)}
      </SettingsSection>
      <SettingsSection title="computers with access" description="revoking access disconnects the computer and stops work owned by its remote session.">
        {status.grants.length === 0 ? <p className="p-4 text-sm text-muted-foreground">no computers have access.</p> : status.grants.map(grant => <SettingsRow key={grant.id} label={grant.label} description={`${grant.active ? grant.accessLevel === "full" ? "full control" : "read only" : "expired or revoked"}${grant.allowTerminal ? " · terminal allowed" : ""}`}>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => revokeDevice(grant.id))}>revoke</Button>
        </SettingsRow>)}
      </SettingsSection>
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />working...</p>}
    </>}
  </>
}
