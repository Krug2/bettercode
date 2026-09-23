import { createContext, useContext, useEffect, useState } from "react"
import { Monitor } from "lucide-react"
import { getRemoteBootstrap } from "@/services/backend/remoteApi"

export interface DeviceView { id: string; label: string; state: string }
export const DeviceViewContext = createContext<DeviceView | undefined>(undefined)

export function DeviceConnectionBar() {
  const device = useContext(DeviceViewContext)
  const [state, setState] = useState(device?.state ?? "connecting")
  useEffect(() => {
    if (!device) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const value = await getRemoteBootstrap()
        if (active) setState(value.authenticated ? value.device?.state ?? "offline" : "reopen from devices")
      } catch { if (active) setState("offline") }
      finally { pending = false }
    }
    void refresh()
    const interval = setInterval(() => { void refresh() }, 3000)
    return () => { active = false; clearInterval(interval) }
  }, [device])
  if (!device) return null
  return <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-xs" role="status">
    <span className="flex items-center gap-2"><Monitor className="size-3.5" /><strong className="font-medium">{device.label}</strong><span className="text-muted-foreground">remote computer</span></span>
    <span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${state === "online" ? "bg-emerald-500" : "bg-amber-500"}`} />{state}</span>
  </div>
}
