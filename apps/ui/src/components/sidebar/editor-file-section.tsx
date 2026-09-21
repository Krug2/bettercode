import { useEffect, useId, useState, type ReactNode } from "react"
import { ChevronRightIcon, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function EditorFileSection({
  sectionId,
  title,
  icon: Icon,
  count,
  modifiedCount = 0,
  actions,
  children,
  defaultOpen = false,
}: {
  sectionId: "open-files" | "recent-files"
  title: string
  icon: LucideIcon
  count: number
  modifiedCount?: number
  actions?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const contentId = useId()
  const headingId = useId()
  const storageKey = `betterc0de-editor-section:${sectionId}`
  // Both sections start collapsed on every app start. The toggle lives in
  // sessionStorage only so it survives switching sidebar views (which remounts
  // this component) without becoming a permanent preference.
  const [open, setOpen] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      return saved === "closed" ? false : saved === "open" ? true : defaultOpen
    } catch {
      return defaultOpen
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, open ? "open" : "closed")
    } catch {
      /* Keep toggling usable when storage is unavailable. */
    }
  }, [open, storageKey])

  return (
    <section
      aria-labelledby={headingId}
      data-editor-file-section={sectionId}
      className="shrink-0 border-t border-border/40"
    >
      <div className="flex min-h-10 items-center px-1">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            id={headingId}
            aria-label={title}
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen((value) => !value)}
            className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline focus-visible:outline-ring"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90"
              )}
            />
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{title}</span>
            <span className="ml-0.5 min-w-4 rounded bg-muted/45 px-1 text-center text-[10px] tabular-nums">
              {count}
            </span>
            {modifiedCount > 0 && (
              <span
                className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                role="img"
                aria-label={`${modifiedCount} unsaved files`}
                title={`${modifiedCount} unsaved files`}
              />
            )}
          </button>
        </h3>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
      <div id={contentId} hidden={!open}>
        {open && children}
      </div>
    </section>
  )
}
