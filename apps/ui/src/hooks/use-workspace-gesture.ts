import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react"
import { resizeWorkspacePanel, type WorkspacePanel } from "@/lib/canvas-workspace"
import type { CanvasRect } from "@/lib/project-canvas"

export function useWorkspaceGesture(zoom: number, commit: (id: string, rect: CanvasRect) => void) {
  const [preview, setPreview] = useState<WorkspacePanel | null>(null)
  const gesture = useRef<{ panel: WorkspacePanel; x: number; y: number; zoom: number; pointer: number; resize: boolean } | null>(null)
  const cancel = useCallback(() => { gesture.current = null; setPreview(null) }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel() }
    window.addEventListener("keydown", key)
    window.addEventListener("blur", cancel)
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", cancel) }
  }, [cancel])
  const begin = (event: PointerEvent, panel: WorkspacePanel, resize = false) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    gesture.current = { panel, x: event.clientX, y: event.clientY, zoom, pointer: event.pointerId, resize }
    setPreview(panel)
  }
  const capture = useCallback((node: HTMLDivElement | null) => {
    if (node && gesture.current) {
      try { node.setPointerCapture(gesture.current.pointer) } catch { cancel() }
    }
  }, [cancel])
  const result = (event: PointerEvent) => {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return null
    const delta = { x: event.clientX - g.x, y: event.clientY - g.y }
    const rect = g.resize ? resizeWorkspacePanel(g.panel, delta, g.zoom) : { ...g.panel, x: g.panel.x + delta.x / g.zoom, y: g.panel.y + delta.y / g.zoom }
    return { ...g.panel, ...rect }
  }
  return {
    preview, begin, resizing: gesture.current?.resize,
    overlayProps: {
      ref: capture,
      onPointerMove: (event: PointerEvent) => { const next = result(event); if (next) setPreview(next) },
      onPointerUp: (event: PointerEvent) => {
        const next = result(event)
        if (next) commit(next.id, { x: next.x, y: next.y, width: next.width, height: next.height })
        cancel()
      },
      onPointerCancel: cancel, onLostPointerCapture: cancel,
    },
  }
}
