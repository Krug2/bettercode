import { GlobeIcon } from "lucide-react"
import { useCanvasWorkspaceStore } from "@/lib/canvas-workspace-store"
import { WorkspaceAddMenu, workspaceChoices } from "./workspace-add-menu"

export function WorkspaceSidebar() {
  const workspace = useCanvasWorkspaceStore()
  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="space-y-3 border-b border-border/60 px-4 py-5">
      <div><h2 className="text-sm font-semibold">Workspace</h2><p className="mt-1 text-xs text-muted-foreground">Everything in one place.</p></div>
      <div className="w-fit rounded-lg border border-border bg-background"><WorkspaceAddMenu onAdd={workspace.request} /></div>
    </header>
    <nav aria-label="Workspace windows" className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
      <p className="px-2 pt-2 pb-3 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Windows · {workspace.panels.length}</p>
      {workspace.panels.map(panel => {
        const Icon = workspaceChoices.find(choice => choice.kind === panel.kind)?.icon ?? GlobeIcon
        return <button type="button" key={panel.id} onClick={() => workspace.focus(panel.id)} aria-current={workspace.selected === panel.id ? "true" : undefined} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted aria-current:bg-muted">
          <Icon size={15} className="shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{panel.title}</span>{panel.url && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{panel.url}</span>}</span>
        </button>
      })}
      {!workspace.panels.length && <p className="px-2 text-xs leading-relaxed text-muted-foreground">Add a browser, usage view, note, or chat. No project needed.</p>}
    </nav>
    <p className="px-4 py-4 text-[10px] leading-relaxed text-muted-foreground">Drag empty space to pan. Scroll to zoom. Over a window, hold Ctrl and scroll to zoom the workspace.</p>
  </div>
}
