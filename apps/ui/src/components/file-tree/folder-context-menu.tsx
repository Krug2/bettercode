import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import {
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Right-click context menu rendered on top of the file tree rows.
 * Pinned to the mouse coordinates that triggered it, dismissed on
 * outside click or Escape. Only the entries the caller needs are shown
 * — `actions` is open-ended so the menu is reusable for files vs
 * folders without a giant prop matrix.
 *
 * The menu is portaled to `document.body` so it visually sits above any
 * tree-internal `overflow:hidden` boundaries (sidebar splitters, etc.).
 */
export interface FolderContextAction {
  id: string
  label: string
  icon?: "copy" | "folder-open" | "open-external" | "rename" | "delete"
  onClick: () => void
  /** Optional muted-foreground description rendered below the label. */
  hint?: string
  destructive?: boolean
}

const ICON_MAP = {
  copy: CopyIcon,
  "folder-open": FolderOpenIcon,
  "open-external": ExternalLinkIcon,
  rename: PencilIcon,
  delete: Trash2Icon,
} as const

export function FolderContextMenu({
  position,
  actions,
  onClose,
}: {
  position: { x: number; y: number } | null
  actions: FolderContextAction[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!position) return
    const handleClick = (e: MouseEvent) => {
      if (!ref.current) return
      if (e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    // Capture phase: catches clicks even when a child stops propagation,
    // matching the behavior most users expect from native context menus.
    document.addEventListener("mousedown", handleClick, true)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick, true)
      document.removeEventListener("keydown", handleKey)
    }
  }, [position, onClose])

  if (!position || actions.length === 0) return null

  // Clamp to viewport so a click near the bottom-right edge doesn't
  // produce a menu that's half off-screen.
  const MAX_W = 220
  const MAX_H = 280
  const x = Math.min(position.x, window.innerWidth - MAX_W - 4)
  const y = Math.min(position.y, window.innerHeight - MAX_H - 4)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left: x, top: y, minWidth: 180 }}
      className={cn(
        "z-50 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-[12px]",
        "animate-in shadow-md duration-100 fade-in"
      )}
      // Suppress browser's native context menu on the popover itself so
      // a second right-click doesn't stack two menus.
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((a) => {
        const Icon = a.icon ? ICON_MAP[a.icon] : null
        return (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            onClick={() => {
              a.onClick()
              onClose()
            }}
            className={cn(
              "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left",
              "transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:outline-none",
              a.destructive && "text-destructive hover:bg-destructive/10"
            )}
          >
            {Icon && (
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  !a.destructive && "text-muted-foreground"
                )}
              />
            )}
            <span className="flex flex-col gap-0.5">
              <span className="leading-tight">{a.label}</span>
              {a.hint && (
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {a.hint}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
