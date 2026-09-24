import { useRef, useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, GlobeIcon, RefreshCwIcon } from "lucide-react"
import { PreviewViewport, type PreviewViewportHandle } from "@/components/browser-preview/preview-viewport"
import { workspaceUrl, type WorkspacePanel } from "@/lib/canvas-workspace"
import { useCanvasWorkspaceStore } from "@/lib/canvas-workspace-store"

export function WorkspaceBrowser({ panel, interactive, onShortcut, onOpenUrl }: {
  panel: WorkspacePanel; interactive: boolean; onShortcut: (key: string) => void; onOpenUrl: (url: string) => void
}) {
  const viewport = useRef<PreviewViewportHandle>(null)
  const address = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState(panel.url)
  const [input, setInput] = useState(panel.url)
  const [history, setHistory] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveUrl = (url: string) => {
    setInput(url)
    useCanvasWorkspaceStore.getState().update(panel.id, { url, title: new URL(url).hostname })
  }
  const navigate = (value: string) => {
    const url = workspaceUrl(value)
    if (!url) { setError("Enter a website address, such as github.com or localhost:3000."); return }
    setError(null); setLoading(true)
    if (url === source) viewport.current?.navigate(url)
    else setSource(url)
    saveUrl(url)
  }
  const reload = () => { setError(null); viewport.current?.reload() }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <form className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2" onSubmit={event => { event.preventDefault(); navigate(input) }} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") { event.preventDefault(); address.current?.select() }
      }}>
        <button type="button" aria-label="Go back" className="rounded p-1.5 hover:bg-muted disabled:opacity-30" disabled={!history.back} onClick={() => viewport.current?.goBackInPage()}><ArrowLeftIcon size={15} /></button>
        <button type="button" aria-label="Go forward" className="rounded p-1.5 hover:bg-muted disabled:opacity-30" disabled={!history.forward} onClick={() => viewport.current?.goForwardInPage()}><ArrowRightIcon size={15} /></button>
        <button type="button" aria-label="Reload page" className="rounded p-1.5 hover:bg-muted" disabled={!source} onClick={reload}><RefreshCwIcon size={14} className={loading ? "animate-spin" : ""} /></button>
        <input ref={address} aria-label="Website address" value={input} onChange={event => setInput(event.target.value)} onFocus={event => event.target.select()} placeholder="Enter a website address…" spellCheck={false} className="mx-1 h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring" />
        <button type="submit" className="rounded px-2 py-1 text-xs hover:bg-muted">Go</button>
        <button type="button" aria-label="Open in external browser" disabled={!panel.url} className="rounded p-1.5 hover:bg-muted disabled:opacity-30" onClick={() => {
          if (window.electronAPI) void window.electronAPI.openExternal(panel.url)
          else window.open(panel.url, "_blank", "noopener,noreferrer")
        }}><ExternalLinkIcon size={14} /></button>
      </form>
      {error && <div role="alert" className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground"><span>{error}</span><button type="button" onClick={reload}>Retry</button></div>}
      {source ? <div className="min-h-0 flex-1"><PreviewViewport ref={viewport} url={source} canvas workspace interactive={interactive} onNavigate={(url, history) => { saveUrl(url); setHistory(history) }} onLoadingChange={setLoading} onLoadError={setError} onOpenUrl={onOpenUrl} onShortcut={key => {
        if (key === "focus-url-bar") { address.current?.focus(); address.current?.select() }
        else if (key === "reload-page") reload()
        else if (key === "navigate-back") viewport.current?.goBackInPage()
        else if (key === "navigate-forward") viewport.current?.goForwardInPage()
        else if (key === "new-browser-tab") onOpenUrl("")
        else if (key === "close-browser-tab") useCanvasWorkspaceStore.getState().remove(panel.id)
        else if (key === "open-devtools") viewport.current?.openDevTools()
        else onShortcut(key)
      }} /></div> : <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <GlobeIcon size={30} strokeWidth={1.2} />
        <p className="text-sm">A place for any website.</p>
        <button type="button" onClick={() => navigate("https://github.com")} className="rounded-lg border border-border px-4 py-2 text-xs hover:bg-muted">Open GitHub</button>
      </div>}
      {!window.electronAPI && source && <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">Some websites, including GitHub, require the desktop app to display here.</p>}
    </div>
  )
}
