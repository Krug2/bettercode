import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
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
import { useCanvasWorkspaceStore } from "@/lib/canvas-workspace-store"
import type { WorkspaceKind } from "@/lib/canvas-workspace"
import { useWorkspaceGesture } from "@/hooks/use-workspace-gesture"
import { WorkspaceWindow } from "./workspace-window"
import { WorkspaceBrowser } from "./workspace-browser"
import { WorkspaceAddMenu, workspaceChoices } from "./workspace-add-menu"

const WorkspaceUsage = lazy(() => import("./workspace-usage"))

/** One camera and one dot grid. Project frames share its coordinate space. */
export function DesignCanvas({
  activeThreadId,
  providers,
  renderChatPanel,
}: {
  activeThreadId: string | null
  providers?: UiProvider[]
  renderChatPanel?: (frame: { className?: string; style?: CSSProperties }) => ReactNode
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
  const workspace = useCanvasWorkspaceStore()
  const initialCamera = useRef(workspace.camera)
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
      [...visible.map((placement) => ({
        ...placement,
        ...canvasProjectSize(settings[placement.threadId]),
      })), ...workspace.panels],
    [visible, settings, workspace.panels]
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
  } = useCanvasTransform(canvasRef, bounds, false, { initial: initialCamera.current, onChange: workspace.saveCamera, wheelZoom: true })
  const windowGesture = useWorkspaceGesture(zoom, workspace.update)
  const addWindow = useCallback((kind: WorkspaceKind, url?: string) => {
    const point = insertionPoint.current ?? nextCanvasPosition(rectangles)
    insertionPoint.current = null
    useCanvasWorkspaceStore.getState().add(kind, point, url)
  }, [rectangles])
  useEffect(() => {
    if (!workspace.requested) return
    addWindow(workspace.requested.kind, workspace.requested.url)
    useCanvasWorkspaceStore.setState({ requested: null })
  }, [workspace.requested, addWindow])
  useEffect(() => {
    if (!workspace.focusRequest) return
    const panel = workspace.panels.find(panel => panel.id === workspace.focusRequest!.id)
    if (panel) fitBounds(panel)
    useCanvasWorkspaceStore.setState({ focusRequest: null })
  }, [workspace.focusRequest, workspace.panels, fitBounds])
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
  const openChat = useCallback((threadId: string) => {
    const store = useChatStore.getState()
    const thread = store.threads.find((item) => item.id === threadId)
    if (!thread) return
    store.setActiveThread(threadId)
    useCanvasWorkspaceStore.getState().request("chat")
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
            aria-label="Canvas workspace"
            className="relative min-h-0 flex-1 overflow-hidden outline-none"
            style={gridStyle}
            onPointerDown={(event) => {
              if (!(event.target as Element).closest("[data-canvas-project],[data-workspace-window],[data-canvas-controls]")) panHandlers.onPointerDown(event)
            }}
            onPointerMove={panHandlers.onPointerMove}
            onPointerUp={panHandlers.onPointerUp}
            onPointerCancel={panHandlers.onPointerCancel}
            onLostPointerCapture={panHandlers.onLostPointerCapture}
            onPointerDownCapture={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.altKey) return
              if ((event.target as Element).closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return
              if (!(event.target as Element).closest("[data-canvas-project],[data-workspace-window]"))
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
                  "[data-canvas-project],[data-workspace-window],[data-canvas-controls]"
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
              if ((event.target as Element).closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return
              if (!(event.target as Element).closest("[data-canvas-project],[data-workspace-window]"))
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
              {workspace.panels.map((saved, index) => {
                const panel = windowGesture.preview?.id === saved.id ? windowGesture.preview : saved
                return <WorkspaceWindow key={panel.id} panel={panel} active={workspace.selected === panel.id} layer={index + 1} onGesture={windowGesture.begin} onFocus={() => workspace.focus(panel.id)}>
                  {panel.kind === "browser" && <WorkspaceBrowser panel={panel} interactive={!panActive && !zoomHeld && !windowGesture.preview} onShortcut={shortcut} onOpenUrl={url => addWindow("browser", url)} />}
                  {(panel.kind === "usage" || panel.kind === "activity") && <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading usage…</p>}><WorkspaceUsage kind={panel.kind} /></Suspense>}
                  {panel.kind === "note" && <textarea aria-label="Workspace note" className="workspace-note" value={panel.text} placeholder="Ideas, links, things to come back to…" onChange={event => workspace.update(panel.id, { text: event.target.value })} />}
                  {panel.kind === "chat" && renderChatPanel?.({ className: "!size-full !rounded-none !border-0", style: { width: "100%" } })}
                </WorkspaceWindow>
              })}
            </div>
            {!rectangles.length && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div
                  className="pointer-events-auto max-w-xs space-y-3 text-center"
                  data-canvas-controls
                >
                  <p className="text-lg font-medium tracking-tight">Your open workspace</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Websites, usage, notes, and chats. Place them anywhere and zoom out to see the whole picture.
                  </p>
                  <div className="flex justify-center"><WorkspaceAddMenu onAdd={addWindow} onProject={addProject} /></div>
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
            {windowGesture.preview && <div data-workspace-drag-overlay aria-hidden="true" className={`fixed inset-0 z-50 touch-none ${windowGesture.resizing ? "cursor-nwse-resize" : "cursor-grabbing"}`} {...windowGesture.overlayProps} />}
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
              <WorkspaceAddMenu onAdd={addWindow} onProject={addProject} />
              <span className="px-2 text-[10px] text-muted-foreground tabular-nums">
                {rectangles.length} {rectangles.length === 1 ? "window" : "windows"}
              </span>
              {visible.length > 0 && <>
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
              </>}
            </div>
            <div
              data-canvas-controls
              className="absolute right-3 bottom-3 z-40 flex items-center gap-0.5 rounded-lg border border-border/60 bg-card/95 px-1 py-0.5 shadow-lg backdrop-blur-sm"
            >
              <ToolButton title="Fit workspace (Ctrl 0)" onClick={fit}>
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
            {workspaceChoices.map(choice => <ContextMenu.Item key={choice.label} className={cn(MENU_ITEM, "flex cursor-default items-center outline-none data-highlighted:bg-accent")} onSelect={() => addWindow(choice.kind, choice.url)}><choice.icon />{choice.label}</ContextMenu.Item>)}
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
              Fit workspace
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
