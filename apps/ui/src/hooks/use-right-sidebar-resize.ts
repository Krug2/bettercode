import { useCallback, useState } from "react"

/**
 * Drag-to-resize logic for the right (workspace) sidebar.
 *
 * Returns `isResizingRight` for visual feedback (e.g. highlight the
 * resize handle while active) and the `onMouseDown`-shaped
 * `handleRightResizeStart` handler to wire onto the handle itself.
 *
 * Clamps the width to 280 px … 60 % of the window (never below 500 px),
 * so the panel can grow generously on wide screens without swallowing
 * the chat column. Listeners are attached to the document (not the
 * handle) so the resize continues even if the cursor leaves the handle
 * element mid-drag.
 */
export function useRightSidebarResize({
  rightSidebarWidth,
  setRightSidebarWidth,
}: {
  rightSidebarWidth: number
  setRightSidebarWidth: (w: number) => void
}) {
  const [isResizingRight, setIsResizingRight] = useState(false)

  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizingRight(true)
      const startX = e.clientX
      const startWidth = rightSidebarWidth

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX
        const maxWidth = Math.max(500, Math.floor(window.innerWidth * 0.6))
        const newWidth = Math.min(maxWidth, Math.max(280, startWidth + delta))
        setRightSidebarWidth(newWidth)
      }

      const handleMouseUp = () => {
        setIsResizingRight(false)
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    [rightSidebarWidth, setRightSidebarWidth]
  )

  return { isResizingRight, handleRightResizeStart }
}
