import type { PointerEvent, ReactNode } from "react"
import { GripIcon, MaximizeIcon, XIcon } from "lucide-react"
import { resizeWorkspacePanel, type WorkspacePanel } from "@/lib/canvas-workspace"
import { useCanvasWorkspaceStore } from "@/lib/canvas-workspace-store"
import "./workspace.css"

export function WorkspaceWindow({ panel, active, layer, onGesture, onFocus, children }: {
  panel: WorkspacePanel; active: boolean; layer: number
  onGesture: (event: PointerEvent, panel: WorkspacePanel, resize?: boolean) => void
  onFocus: () => void; children: ReactNode
}) {
  const store = useCanvasWorkspaceStore.getState()
  return (
    <article data-workspace-window={panel.id} data-workspace-kind={panel.kind} data-active={active} aria-label={panel.title} className="workspace-window" style={{ transform: `translate(${panel.x}px, ${panel.y}px)`, width: panel.width, height: panel.height, zIndex: layer }} onPointerDownCapture={() => store.raise(panel.id)} onFocusCapture={() => store.raise(panel.id)}>
      <header className="workspace-window-header">
        <button type="button" className="workspace-window-handle" aria-label={`Move ${panel.title}`} onPointerDown={event => onGesture(event, panel)} onDoubleClick={onFocus} onKeyDown={event => {
          const step = event.shiftKey ? 80 : 20
          const directions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
          const move = directions[event.key]
          if (move) { event.preventDefault(); store.update(panel.id, { x: panel.x + move[0], y: panel.y + move[1] }) }
        }}><GripIcon size={14} /><span>{panel.title}</span></button>
        <button type="button" aria-label={`Focus ${panel.title}`} title="Focus window · double-click its title" onClick={onFocus}><MaximizeIcon size={14} /></button>
        <button type="button" aria-label={`Close ${panel.title}`} onClick={() => store.remove(panel.id)}><XIcon size={15} /></button>
      </header>
      <div className="workspace-window-content" data-canvas-controls>{children}</div>
      <button type="button" className="workspace-window-resize" aria-label={`Resize ${panel.title}`} title="Drag to resize" onPointerDown={event => onGesture(event, panel, true)} onKeyDown={event => {
        const step = event.shiftKey ? 80 : 20
        const directions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
        const delta = directions[event.key]
        if (delta) { event.preventDefault(); store.update(panel.id, resizeWorkspacePanel(panel, { x: delta[0], y: delta[1] }, 1)) }
      }} />
    </article>
  )
}
