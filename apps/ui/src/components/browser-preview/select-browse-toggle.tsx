import { MousePointerClickIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * The Select ⇄ Browse switch of a live preview. Select lays a host-side
 * overlay over the page so a click picks the element under the pointer for
 * the chat and the inspector; Browse hands the page back to the user. The
 * editor's preview toolbar and the canvas toolbar render this one component,
 * so the two surfaces cannot drift apart.
 */
export function SelectBrowseToggle({
  selectionMode,
  onToggle,
  available,
}: {
  selectionMode: boolean
  onToggle: () => void
  /** Element selection needs the Electron webview; false renders it disabled. */
  available: boolean
}) {
  return (
    <Button
      type="button"
      variant={selectionMode ? "secondary" : "ghost"}
      size="xs"
      aria-label="Select elements for chat"
      aria-pressed={selectionMode}
      disabled={!available}
      title={
        available
          ? "Select elements without activating the page. Escape to browse."
          : "Element selection is available in the desktop app"
      }
      className="shrink-0 gap-1.5 text-[11px]"
      onClick={onToggle}
    >
      <MousePointerClickIcon className="size-3.5" />
      <span className="hidden sm:inline">
        {selectionMode ? "Select" : "Browse"}
      </span>
    </Button>
  )
}
