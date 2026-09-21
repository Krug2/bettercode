import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ContextMenu } from "radix-ui"
import {
  HandIcon,
  MaximizeIcon,
  MinusIcon,
  MousePointer2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react"
import { normalizeBrowserElement } from "@betterc0de/schema"
import { useCanvasTransform } from "@/hooks/use-canvas-transform"
import { useCanvasProjectDrag } from "@/hooks/use-canvas-project-drag"
import { useChatStore } from "@/lib/chat-store"
import type { UiProvider } from "@/lib/provider-types"
import {
  MAX_BROWSER_ELEMENTS,
  useBrowserContextStore,
} from "@/lib/browser-context-store"
import {
  canvasBounds,
  canvasProjectSize,
  nextCanvasPosition,
  PROJECT_CANVAS_STORAGE_KEY,
  readCanvasPlacements,
  screenToCanvas,
  type CanvasPlacement,
  type CanvasPoint,
} from "@/lib/project-canvas"
import type { SelectedElement } from "@/components/browser-preview/types"
import { SelectBrowseToggle } from "@/components/browser-preview/select-browse-toggle"
import { cssChangesPrompt } from "@/components/browser-preview/inspector-state"
import { dispatchComposerDraftRestoreAfterSubmit } from "@/lib/composer-draft-events"
import { useCanvasPreviewStore } from "./canvas-preview-store"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { MENU_PANEL, MENU_ITEM } from "@/components/ui/menu-chrome"
import { CanvasProjectFrame } from "./canvas-project-frame"
import { CanvasProjectPicker } from "./canvas-project-picker"
import { ToolButton, ToolbarDivider } from "./design-preview-controls"

/** One camera and one dot grid. Project frames share its coordinate space. */
export function DesignCanvas({
  activeThreadId,
  providers,
}: {
  activeThreadId: string | null
  providers?: UiProvider[]
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const threads = useChatStore((state) => state.threads)
  const settings = useChatStore((state) => state.settingsByThread)
  const [placements, setPlacements] = useState<CanvasPlacement[]>(() => {
    try {
      return readCanvasPlacements(
        localStorage.getItem(PROJECT_CANVAS_STORAGE_KEY)
      )
    } catch {
      return []
    }
  })
  const [tool, setTool] = useState<"select" | "hand">("select")
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectionMode = useCanvasPreviewStore((state) => state.selectionMode)
  const setSelectionMode = useCanvasPreviewStore((state) => state.setSelectionMode)
  const inspectorOpen = useCanvasPreviewStore((state) => state.inspectorOpen)
  const setInspectorOpen = useCanvasPreviewStore((state) => state.setInspectorOpen)
  const pendingCssChanges = useCanvasPreviewStore(
    (state) => state.inspector.cssChanges.length
  )
  const insertionPoint = useRef<CanvasPoint | null>(null)
  const lastActive = useRef<string | null>(null)
  const visible = useMemo(
    () =>
      placements.filter(
        (placement) =>
          !placement.hidden &&
          threads.some((thread) => thread.id === placement.threadId)
      ),
    [placements, threads]
  )
  const rectangles = useMemo(
    () =>
      visible.map((placement) => ({
        ...placement,
        ...canvasProjectSize(settings[placement.threadId]),
      })),
    [visible, settings]
  )
  const bounds = useMemo(() => canvasBounds(rectangles), [rectangles])
  const {
    zoom,
    pan,
    stageStyle,
    gridStyle,
    isPanning,
    spaceHeld,
    altHeld,
    zoomHeld,
    beginZoomGesture,
    beginPanGesture,
    zoomIn,
    zoomOut,
    zoomTo,
    fit,
    fitBounds,
    panHandlers,
  } = useCanvasTransform(canvasRef, bounds, false)
  // Guests re-render at the settled zoom, not at every frame of a gesture.
  const panActive = tool === "hand" || spaceHeld || altHeld

  useEffect(() => {
    try {
      localStorage.setItem(
        PROJECT_CANVAS_STORAGE_KEY,
        JSON.stringify(placements)
      )
    } catch {
      /* The board still works without storage. */
    }
  }, [placements])
  useEffect(() => {
    if (
      !activeThreadId ||
      !threads.some((thread) => thread.id === activeThreadId) ||
      lastActive.current === activeThreadId
    )
      return
    const initialSelection = lastActive.current === null
    lastActive.current = activeThreadId
    const existing = placements.find(
      (placement) => placement.threadId === activeThreadId
    )
    if (existing) {
      if (initialSelection) fitBounds(canvasBounds(rectangles))
      return
    }
    const point = nextCanvasPosition(rectangles)
    setPlacements((previous) => [
      ...previous,
      { threadId: activeThreadId, ...point },
    ])
    fitBounds(
      canvasBounds([
        ...rectangles,
        { ...point, ...canvasProjectSize(settings[activeThreadId]) },
      ])
    )
  }, [activeThreadId, threads, placements, rectangles, settings, fitBounds])

  const openChat = useCallback((threadId: string) => {
    const store = useChatStore.getState()
    const thread = store.threads.find((item) => item.id === threadId)
    if (!thread) return
    store.setActiveThread(threadId)
    window.dispatchEvent(
      new CustomEvent("betterc0de:open-thread", {
        detail: { threadId, label: thread.title || "Chat" },
      })
    )
  }, [])
  const attach = (threadId: string) => {
    const existing = placements.find((item) => item.threadId === threadId)
    if (existing && !existing.hidden) {
      openChat(threadId)
      return
    }
    const point =
      insertionPoint.current ??
      (existing
        ? { x: existing.x, y: existing.y }
        : nextCanvasPosition(rectangles))
    insertionPoint.current = null
    setPlacements((previous) => [
      ...previous.filter((item) => item.threadId !== threadId),
      { threadId, ...point },
    ])
    lastActive.current = threadId
    openChat(threadId)
    fitBounds(
      canvasBounds([
        ...rectangles,
        {
          ...point,
          ...canvasProjectSize(
            useChatStore.getState().settingsByThread[threadId]
          ),
        },
      ])
    )
  }
  const move = useCallback((threadId: string, point: CanvasPoint) => {
    setPlacements((previous) =>
      previous.map((item) =>
        item.threadId === threadId ? { threadId, ...point } : item
      )
    )
  }, [])
  const drag = useCanvasProjectDrag(zoom, move)
  const remove = useCallback((threadId: string) => {
    setPlacements((previous) =>
      previous.map((item) =>
        item.threadId === threadId ? { ...item, hidden: true } : item
      )
    )
  }, [])
  const pickElement = useCallback(
    (threadId: string, picked: SelectedElement) => {
      const element = normalizeBrowserElement(picked)
      if (!element) return
      if (!useBrowserContextStore.getState().add(threadId, element))
        toast.info(
          `You can select up to ${MAX_BROWSER_ELEMENTS} elements per message`
        )
      openChat(threadId)
    },
    [openChat]
  )
  const shortcut = useCallback(
    (key: string) => {
      if (key === "canvas-zoom-start") beginZoomGesture()
      else if (key === "canvas-pan-start") beginPanGesture()
      else if (key === "zoom-in") zoomIn()
      else if (key === "zoom-out") zoomOut()
      else if (key === "zoom-reset") fit()
    },
    [zoomIn, zoomOut, fit, beginZoomGesture, beginPanGesture]
  )

  const addProject = () => {
    insertionPoint.current = null
    setPickerOpen(true)
  }
  // Same batch the editor's preview sends: the buffered style edits become a
  // change request in the inspected card's own chat.
  const sendCssToAI = () => {
    const store = useCanvasPreviewStore.getState()
    const focus = store.focus
    if (!focus) return
    const changes = store.takeCssChanges()
    if (changes.length === 0) return
    const chat = useChatStore.getState()
    dispatchComposerDraftRestoreAfterSubmit({
      threadId: focus.threadId,
      text: [chat.getDraft(focus.threadId), cssChangesPrompt(changes, focus.pageUrl)]
        .filter(Boolean)
        .join("\n\n"),
    })
    openChat(focus.threadId)
  }
  return (
    <section
      data-project-canvas
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger asChild>
          <div
            ref={canvasRef}
            data-canvas-viewport
            tabIndex={0}
            aria-label="Project canvas"
            className="relative min-h-0 flex-1 overflow-hidden outline-none"
            style={gridStyle}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget)
                event.currentTarget.focus()
            }}
            onPointerDownCapture={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.altKey) return
              if (!(event.target as Element).closest("[data-canvas-project]"))
                return
              event.preventDefault()
              event.stopPropagation()
              if (event.ctrlKey || event.metaKey) beginZoomGesture()
              else beginPanGesture()
            }}
            onContextMenu={(event) => {
              if (
                zoomHeld ||
                panActive ||
                (event.target as Element).closest(
                  "[data-canvas-project],[data-canvas-controls]"
                )
              ) {
                event.preventDefault()
                return
              }
              const rect = event.currentTarget.getBoundingClientRect()
              insertionPoint.current = screenToCanvas(
                { x: event.clientX, y: event.clientY },
                { x: rect.left, y: rect.top },
                pan,
                zoom
              )
            }}
            onClickCapture={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.altKey) return
              if (!(event.target as Element).closest("[data-canvas-project]"))
                return
              event.preventDefault()
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                (event.target as Element).closest(
                  "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=dialog]"
                )
              )
                return
              if (event.ctrlKey || event.metaKey) {
                if (event.key === "+" || event.key === "=") {
                  event.preventDefault()
                  zoomIn()
                } else if (event.key === "-") {
                  event.preventDefault()
                  zoomOut()
                } else if (event.key === "0") {
                  event.preventDefault()
                  fit()
                }
              } else if (!event.altKey) {
                if (event.key.toLowerCase() === "v") {
                  event.preventDefault()
                  setTool("select")
                  canvasRef.current?.focus({ preventScroll: true })
                } else if (event.key.toLowerCase() === "h") {
                  event.preventDefault()
                  setTool("hand")
                  canvasRef.current?.focus({ preventScroll: true })
                }
              }
            }}
          >
            <div
              data-canvas-stage
              inert={zoomHeld || panActive}
              className="absolute top-0 left-0"
              style={stageStyle}
            >
              {visible.map((placement) => {
                const point =
                  drag.preview?.threadId === placement.threadId
                    ? drag.preview
                    : placement
                return (
                  <div
                    key={placement.threadId}
                    data-canvas-position={placement.threadId}
                    className="absolute top-0 left-0"
                    style={{
                      transform: `translate(${point.x}px, ${point.y}px)`,
                      width: canvasProjectSize(settings[placement.threadId])
                        .width,
                    }}
                  >
                    <CanvasProjectFrame
                      providers={providers}
                      placement={placement}
                      active={placement.threadId === activeThreadId}
                      panActive={tool === "hand" || Boolean(drag.preview)}
                      onOpenChat={openChat}
                      onRemove={remove}
                      onMoveStart={drag.begin}
                      onMove={move}
                      onElementSelected={pickElement}
                      onShortcut={shortcut}
                      zoom={zoom}
                    />
                  </div>
                )
              })}
            </div>
            {!visible.length && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div
                  className="pointer-events-auto max-w-xs space-y-3 text-center"
                  data-canvas-controls
                >
                  <p className="text-sm font-medium">Your project canvas</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Bring a repo or chat onto the canvas to connect its live
                    preview.
                  </p>
                  <button
                    type="button"
                    onClick={addProject}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
                  >
                    Add your first project
                  </button>
                </div>
              </div>
            )}
            {(panActive || zoomHeld) && (
              <div
                data-canvas-navigation={zoomHeld ? "zoom" : "pan"}
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 z-30 touch-none",
                  zoomHeld
                    ? "cursor-zoom-in"
                    : isPanning
                      ? "cursor-grabbing"
                      : "cursor-grab"
                )}
                {...(zoomHeld
                  ? {
                      onPointerDown: (
                        event: React.PointerEvent<HTMLDivElement>
                      ) => {
                        event.preventDefault()
                        canvasRef.current?.focus({ preventScroll: true })
                      },
                    }
                  : panHandlers)}
              />
            )}
            {drag.preview && (
              <div
                data-canvas-drag-overlay
                aria-hidden="true"
                className="fixed inset-0 z-50 cursor-grabbing touch-none"
                {...drag.overlayProps}
              />
            )}
            <div
              data-canvas-controls
              className="absolute top-3 left-3 z-40 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-card/95 px-1.5 py-1 shadow-xl backdrop-blur-sm"
            >
              <ToolButton
                active={!panActive}
                title="Select (V)"
                onClick={() => {
                  setTool("select")
                  canvasRef.current?.focus({ preventScroll: true })
                }}
              >
                <MousePointer2Icon className="size-3.5" />
              </ToolButton>
              <ToolButton
                active={panActive}
                title="Hand — pan the canvas (H, or hold Alt / Space)"
                onClick={() => {
                  setTool("hand")
                  canvasRef.current?.focus({ preventScroll: true })
                }}
              >
                <HandIcon className="size-3.5" />
              </ToolButton>
              <ToolbarDivider />
              <button
                type="button"
                onClick={addProject}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PlusIcon className="size-3.5" />
                Add project
              </button>
              <span className="px-2 text-[10px] text-muted-foreground tabular-nums">
                {visible.length} {visible.length === 1 ? "project" : "projects"}
              </span>
              <ToolbarDivider />
              <SelectBrowseToggle
                selectionMode={selectionMode}
                onToggle={() => setSelectionMode(!selectionMode)}
                available={Boolean(window.electronAPI)}
              />
              <ToolButton
                active={inspectorOpen}
                title="Elements — inspect and edit the focused preview"
                onClick={() => setInspectorOpen(!inspectorOpen)}
              >
                {inspectorOpen ? (
                  <PanelLeftCloseIcon className="size-3.5" />
                ) : (
                  <PanelLeftOpenIcon className="size-3.5" />
                )}
              </ToolButton>
              {pendingCssChanges > 0 && (
                <button
                  type="button"
                  onClick={sendCssToAI}
                  className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <SparklesIcon className="size-3.5" />
                  Send to AI
                  <span className="rounded bg-primary-foreground/20 px-1 text-[10px] tabular-nums">
                    {pendingCssChanges}
                  </span>
                </button>
              )}
            </div>
            <div
              data-canvas-controls
              className="absolute right-3 bottom-3 z-40 flex items-center gap-0.5 rounded-lg border border-border/60 bg-card/95 px-1 py-0.5 shadow-lg backdrop-blur-sm"
            >
              <ToolButton title="Fit all projects (Ctrl 0)" onClick={fit}>
                <MaximizeIcon className="size-3.5" />
              </ToolButton>
              <ToolbarDivider />
              <ToolButton title="Zoom out (Ctrl -)" onClick={zoomOut}>
                <MinusIcon className="size-3.5" />
              </ToolButton>
              <button
                type="button"
                onClick={() => zoomTo(1)}
                title="Reset to 100%"
                className="h-6 min-w-12 rounded-md font-mono text-[11px] hover:bg-muted"
              >
                {Math.round(zoom * 100)}%
              </button>
              <ToolButton title="Zoom in (Ctrl +)" onClick={zoomIn}>
                <PlusIcon className="size-3.5" />
              </ToolButton>
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className={cn(MENU_PANEL, "z-50 min-w-48 text-foreground")}
          >
            <ContextMenu.Item
              className={cn(
                MENU_ITEM,
                "flex cursor-default items-center outline-none data-highlighted:bg-accent"
              )}
              onSelect={() => setPickerOpen(true)}
            >
              <PlusIcon />
              Add repo or chat here
            </ContextMenu.Item>
            <ContextMenu.Item
              className={cn(
                MENU_ITEM,
                "flex cursor-default items-center outline-none data-highlighted:bg-accent"
              )}
              onSelect={fit}
            >
              <MaximizeIcon />
              Fit all projects
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <CanvasProjectPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        attachedIds={visible.map((item) => item.threadId)}
        onAttach={attach}
      />
    </section>
  )
}
