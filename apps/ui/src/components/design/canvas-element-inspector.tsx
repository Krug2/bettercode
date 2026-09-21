import { LayersIcon } from "lucide-react"
import { CANVAS_DEVICE_PRESETS } from "@/components/browser-preview/constants"
import { ElementInspector } from "@/components/browser-preview/element-inspector"
import { useChatStore } from "@/lib/chat-store"
import { useCanvasPreviewStore } from "./canvas-preview-store"

/**
 * The canvas's element side panel: the editor's `ElementInspector`, fed by
 * whichever card preview was picked in or focused last. Style edits go back
 * to that same preview. Only the caption above it is canvas-specific,
 * because here the panel has to say which page it is looking at.
 */
export function CanvasElementInspector() {
  const focus = useCanvasPreviewStore((state) => state.focus)
  const inspector = useCanvasPreviewStore((state) => state.inspector)
  const setTab = useCanvasPreviewStore((state) => state.setTab)
  const selectFromTree = useCanvasPreviewStore((state) => state.selectFromTree)
  const highlight = useCanvasPreviewStore((state) => state.highlight)
  const clearSelection = useCanvasPreviewStore((state) => state.clearSelection)
  const applyStyle = useCanvasPreviewStore((state) => state.applyStyle)
  const projectName = useChatStore((state) =>
    focus
      ? state.threads.find((thread) => thread.id === focus.threadId)?.projectName
      : undefined
  )
  const device = focus
    ? CANVAS_DEVICE_PRESETS.find((preset) => preset.id === focus.deviceId)
    : undefined
  const caption = focus
    ? `${projectName || "Project"} · ${device?.label ?? focus.deviceId}`
    : "Pick an element in a preview to inspect it"
  return (
    <div
      data-canvas-inspector
      data-canvas-inspector-focus={focus?.key}
      className="flex min-h-0 shrink-0 flex-col border-r border-border/40"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-sidebar px-3 text-[11px] text-muted-foreground">
        <LayersIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={focus?.pageUrl}>
          {caption}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <ElementInspector
          tree={inspector.tree}
          selected={inspector.selected}
          tab={inspector.tab}
          onTabChange={setTab}
          onSelect={selectFromTree}
          onHighlight={highlight}
          onClear={clearSelection}
          loading={false}
          styles={inspector.editedStyles}
          onStyleChange={applyStyle}
          pageUrl={focus?.pageUrl ?? ""}
        />
      </div>
    </div>
  )
}
