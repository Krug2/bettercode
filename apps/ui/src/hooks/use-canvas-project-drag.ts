import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react"
import {
  moveOnCanvas,
  type CanvasPlacement,
  type CanvasPoint,
} from "@/lib/project-canvas"

/** Capture on an overlay so crossing a guest iframe cannot strand a drag. */
export function useCanvasProjectDrag(
  zoom: number,
  onCommit: (id: string, point: CanvasPoint) => void
) {
  const [preview, setPreview] = useState<CanvasPlacement | null>(null)
  const drag = useRef<{
    origin: CanvasPlacement
    start: CanvasPoint
    point: CanvasPoint
    zoom: number
    pointerId: number
  } | null>(null)
  const cancel = useCallback(() => {
    drag.current = null
    setPreview(null)
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel()
    }
    window.addEventListener("keydown", key)
    window.addEventListener("blur", cancel)
    return () => {
      window.removeEventListener("keydown", key)
      window.removeEventListener("blur", cancel)
    }
  }, [cancel])
  const begin = (event: PointerEvent, origin: CanvasPlacement) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    drag.current = {
      origin,
      point: origin,
      start: { x: event.clientX, y: event.clientY },
      zoom,
      pointerId: event.pointerId,
    }
    setPreview(origin)
  }
  const capture = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && drag.current) {
        try {
          node.setPointerCapture(drag.current.pointerId)
        } catch {
          cancel()
        }
      }
    },
    [cancel]
  )
  const move = (event: PointerEvent) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    current.point = moveOnCanvas(
      current.origin,
      {
        x: event.clientX - current.start.x,
        y: event.clientY - current.start.y,
      },
      current.zoom
    )
    setPreview({ threadId: current.origin.threadId, ...current.point })
  }
  const end = (event: PointerEvent) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const point = moveOnCanvas(
      current.origin,
      {
        x: event.clientX - current.start.x,
        y: event.clientY - current.start.y,
      },
      current.zoom
    )
    onCommit(current.origin.threadId, point)
    cancel()
  }
  return {
    preview,
    begin,
    overlayProps: {
      ref: capture,
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    },
  }
}
