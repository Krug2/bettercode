import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export type PaneDropTabZone = "left" | "right" | "top" | "bottom" | "center"

export const PANE_TAB_DRAG_TYPE = "application/betterc0de-pane-tab"
export const THREAD_DRAG_TYPE = "application/betterc0de-thread"

function hasDragType(e: React.DragEvent): boolean {
  return (
    e.dataTransfer.types.includes(PANE_TAB_DRAG_TYPE) ||
    e.dataTransfer.types.includes(THREAD_DRAG_TYPE)
  )
}

/**
 * Wraps a pane with 2-D drag-to-split drop zones. Accepts a dragged pane tab
 * (`onDropTab`) or a dragged sidebar chat (`onDropThread`): dropping on an edge
 * (left/right/top/bottom) creates a new pane next to this one; dropping on the
 * center moves the tab / adds the chat into this pane.
 */
export function PaneDropZone({
  children,
  onDropTab,
  onDropThread,
}: {
  children: ReactNode
  onDropTab: (fromPaneId: string, tabId: string, zone: PaneDropTabZone) => void
  onDropThread?: (
    threadId: string,
    label: string | undefined,
    zone: PaneDropTabZone
  ) => void
}) {
  const [zone, setZone] = useState<PaneDropTabZone | null>(null)

  const zoneFromEvent = (
    e: React.DragEvent<HTMLDivElement>
  ): PaneDropTabZone => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / Math.max(1, r.width)
    const y = (e.clientY - r.top) / Math.max(1, r.height)
    const left = x
    const right = 1 - x
    const top = y
    const bottom = 1 - y
    const min = Math.min(left, right, top, bottom)
    if (min > 0.25) return "center"
    if (min === left) return "left"
    if (min === right) return "right"
    if (min === top) return "top"
    return "bottom"
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onDragOver={(e) => {
        if (!hasDragType(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        setZone(zoneFromEvent(e))
      }}
      onDragLeave={(e) => {
        // Ignore leave events bubbling from children.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setZone(null)
      }}
      onDrop={(e) => {
        if (!hasDragType(e)) {
          setZone(null)
          return
        }
        e.preventDefault()
        const z = zoneFromEvent(e)
        setZone(null)
        try {
          if (e.dataTransfer.types.includes(PANE_TAB_DRAG_TYPE)) {
            const { paneId, tabId } = JSON.parse(
              e.dataTransfer.getData(PANE_TAB_DRAG_TYPE)
            )
            if (paneId && tabId) onDropTab(paneId, tabId, z)
          } else if (e.dataTransfer.types.includes(THREAD_DRAG_TYPE)) {
            const { threadId, label } = JSON.parse(
              e.dataTransfer.getData(THREAD_DRAG_TYPE)
            )
            if (threadId) onDropThread?.(threadId, label, z)
          }
        } catch {
          /* malformed payload — ignore */
        }
      }}
    >
      {children}
      {zone && (
        <div
          className={cn(
            "pointer-events-none absolute z-20 bg-primary/30 transition-all",
            zone === "left" && "inset-y-0 left-0 w-1/3",
            zone === "right" && "inset-y-0 right-0 w-1/3",
            zone === "top" && "inset-x-0 top-0 h-1/3",
            zone === "bottom" && "inset-x-0 bottom-0 h-1/3",
            zone === "center" && "inset-2 rounded-md border-2 border-primary/60"
          )}
        />
      )}
    </div>
  )
}
