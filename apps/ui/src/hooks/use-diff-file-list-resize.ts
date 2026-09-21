import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { usePreferencesStore } from "@/lib/preferences-store"
import {
  clampDiffFileListWidth,
  DEFAULT_DIFF_FILE_LIST_WIDTH,
  maxDiffFileListWidth,
  MIN_DIFF_FILE_LIST_WIDTH,
} from "@/lib/diff-layout"

export function useDiffFileListResize(open: boolean) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const storedWidth = usePreferencesStore((state) => state.diffFileListWidth)
  const [panelWidth, setPanelWidth] = useState(1000)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    width: number
  } | null>(null)
  const width = clampDiffFileListWidth(dragWidth ?? storedWidth, panelWidth)
  const saveWidth = (value: number) =>
    usePreferencesStore.getState().set("diffFileListWidth", value)

  useEffect(() => {
    if (!open || !bodyRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPanelWidth(entry.contentRect.width)
    })
    observer.observe(bodyRef.current)
    return () => {
      observer.disconnect()
      drag.current = null
      setDragWidth(null)
    }
  }, [open])

  const finishDrag = (element: HTMLDivElement, cancelled: boolean) => {
    const current = drag.current
    if (!current) return
    drag.current = null
    if (!cancelled) saveWidth(clampDiffFileListWidth(current.width, panelWidth))
    setDragWidth(null)
    if (element.hasPointerCapture(current.pointerId))
      element.releasePointerCapture(current.pointerId)
  }

  return {
    bodyRef,
    width,
    isResizing: dragWidth !== null,
    handleProps: {
      role: "separator" as const,
      "aria-label": "Resize file list",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": MIN_DIFF_FILE_LIST_WIDTH,
      "aria-valuemax": maxDiffFileListWidth(panelWidth),
      "aria-valuenow": Math.round(width),
      "aria-valuetext": `${Math.round(width)} pixels`,
      tabIndex: 0,
      title: "Drag to resize file list. Double-click to reset.",
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          width,
        }
        setDragWidth(width)
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        current.width = clampDiffFileListWidth(
          current.startWidth + event.clientX - current.startX,
          panelWidth
        )
        setDragWidth(current.width)
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId === event.pointerId)
          finishDrag(event.currentTarget, false)
      },
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId === event.pointerId)
          finishDrag(event.currentTarget, true)
      },
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) =>
        finishDrag(event.currentTarget, true),
      onDoubleClick: () => saveWidth(DEFAULT_DIFF_FILE_LIST_WIDTH),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          finishDrag(event.currentTarget, true)
          return
        }
        const step = event.shiftKey ? 50 : 10
        const next =
          event.key === "ArrowLeft"
            ? width - step
            : event.key === "ArrowRight"
              ? width + step
              : event.key === "Home"
                ? MIN_DIFF_FILE_LIST_WIDTH
                : event.key === "End"
                  ? maxDiffFileListWidth(panelWidth)
                  : null
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        saveWidth(clampDiffFileListWidth(next, panelWidth))
      },
    },
  }
}
