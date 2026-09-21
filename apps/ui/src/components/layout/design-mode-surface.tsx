import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"
import { DesignCanvas } from "@/components/design/design-canvas"
import { CanvasElementInspector } from "@/components/design/canvas-element-inspector"
import { useCanvasPreviewStore } from "@/components/design/canvas-preview-store"
import { cn } from "@/lib/utils"
import type { UiProvider } from "@/lib/provider-types"
import {
  DESIGN_CHAT_PANEL_DEFAULT_WIDTH,
  DESIGN_CHAT_PANEL_STORAGE_KEY,
  clampDesignChatPanelWidth,
  readStoredDesignChatPanelWidth,
} from "@/lib/editor-layout"

type DesignModeSurfaceProps = {
  providers?: UiProvider[]
  activeThreadId: string | null
  /**
   * The chat container, built by `MainArea` from the same code path the
   * editor uses (`ChatWorkbenchPanel`). This surface only decides its width
   * and where it sits; nothing about the chat itself is design-specific.
   */
  renderChatPanel: (frame: {
    className?: string
    style?: CSSProperties
  }) => ReactNode
}

export function DesignModeSurface({
  providers,
  activeThreadId,
  renderChatPanel,
}: DesignModeSurfaceProps) {
  // Measure the workbench itself: opening or resizing the file sidebar also
  // changes how much room the canvas and chat can share.
  const workbenchRef = useRef<HTMLElement>(null)
  const [chatWidthPreference, setChatWidthPreference] = useState(() =>
    readStoredDesignChatPanelWidth(
      typeof localStorage === "undefined" ? null : localStorage
    )
  )
  const [availableWidth, setAvailableWidth] = useState(() =>
    typeof window === "undefined" ? 1920 : window.innerWidth
  )
  useEffect(() => {
    const element = workbenchRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(Math.max(0, entry.contentRect.width - 8))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(
        DESIGN_CHAT_PANEL_STORAGE_KEY,
        String(chatWidthPreference)
      )
    } catch {
      /* Resizing stays usable when storage is unavailable. */
    }
  }, [chatWidthPreference])
  const chatWidth = clampDesignChatPanelWidth(
    chatWidthPreference,
    availableWidth
  )
  // While a drag is in flight a full-window overlay owns the pointer: the
  // preview is an iframe, and once the cursor crosses into it the window
  // stops receiving mousemove/mouseup and the drag would silently die there.
  const [chatDrag, setChatDrag] = useState<{ x: number; width: number } | null>(
    null
  )
  const [resizingChat, setResizingChat] = useState(false)
  useEffect(() => {
    if (!chatDrag) return
    const onMove = (event: MouseEvent) => {
      // A click must still reach the separator so double-click can reset it.
      // Cover the preview only after the pointer actually starts dragging.
      if (!resizingChat && Math.abs(chatDrag.x - event.clientX) < 3) return
      setResizingChat(true)
      setChatWidthPreference(
        clampDesignChatPanelWidth(
          chatDrag.width + chatDrag.x - event.clientX,
          availableWidth
        )
      )
    }
    const onEnd = () => {
      setChatDrag(null)
      setResizingChat(false)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onEnd)
    window.addEventListener("blur", onEnd)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onEnd)
      window.removeEventListener("blur", onEnd)
    }
  }, [chatDrag, availableWidth, resizingChat])
  const startChatResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      setChatDrag({ x: event.clientX, width: chatWidth })
    },
    [chatWidth]
  )
  const resetChatWidth = useCallback(
    () => setChatWidthPreference(DESIGN_CHAT_PANEL_DEFAULT_WIDTH),
    []
  )
  const inspectorOpen = useCanvasPreviewStore((state) => state.inspectorOpen)
  // Match editor mode: workspace on the left, the shared chat on the right.
  return (
    <main
      ref={workbenchRef}
      data-design-workbench
      className="editor-workbench flex min-h-0 min-w-0 flex-1 overflow-hidden bg-sidebar p-2 text-foreground"
    >
      <div className="editor-code-panel flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/40 bg-background">
        {inspectorOpen && <CanvasElementInspector />}
        <DesignCanvas activeThreadId={activeThreadId} providers={providers} />
      </div>

      {/* Resizer lives in the gap between the cards, like the editor's. The
          drag overlay is needed here and not there because this side has an
          iframe that would otherwise swallow the pointer mid-drag. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat column"
        aria-valuenow={chatWidth}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        data-resizing={resizingChat || undefined}
        className={cn(
          "mx-0.5 w-1 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-border focus-visible:bg-border focus-visible:outline-none active:bg-muted-foreground/50",
          resizingChat && "bg-muted-foreground/50"
        )}
        onMouseDown={startChatResize}
        onDoubleClick={resetChatWidth}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          setChatWidthPreference(
            clampDesignChatPanelWidth(
              chatWidth + (event.key === "ArrowLeft" ? 20 : -20),
              availableWidth
            )
          )
        }}
      />
      {resizingChat && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 cursor-col-resize select-none"
        />
      )}

      {renderChatPanel({
        className: "relative",
        style: { width: chatWidth },
      })}
    </main>
  )
}
