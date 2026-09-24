import type { CSSProperties, ReactNode } from "react"
import { DesignCanvas } from "@/components/design/design-canvas"
import { CanvasElementInspector } from "@/components/design/canvas-element-inspector"
import { useCanvasPreviewStore } from "@/components/design/canvas-preview-store"
import type { UiProvider } from "@/lib/provider-types"

export function DesignModeSurface({ providers, activeThreadId, renderChatPanel }: {
  providers?: UiProvider[]
  activeThreadId: string | null
  renderChatPanel: (frame: { className?: string; style?: CSSProperties }) => ReactNode
}) {
  const inspectorOpen = useCanvasPreviewStore(state => state.inspectorOpen)
  return (
    <main data-design-workbench className="editor-workbench flex min-h-0 min-w-0 flex-1 overflow-hidden bg-sidebar p-2 text-foreground">
      <div className="editor-code-panel flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/40 bg-background">
        {inspectorOpen && <CanvasElementInspector />}
        <DesignCanvas activeThreadId={activeThreadId} providers={providers} renderChatPanel={renderChatPanel} />
      </div>
    </main>
  )
}
