import { useState, useRef, useEffect, useCallback } from "react"
import { ChevronRightIcon, PencilIcon, CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface BreadcrumbPathBarProps {
  path: string | null
  onNavigate: (path: string) => void
  editMode: boolean
  onRequestEditMode: (on: boolean) => void
}

function splitSegments(p: string): { label: string; absolute: string }[] {
  if (!p) return []
  if (p === "/") return [{ label: "/", absolute: "/" }]
  // Windows: "C:\foo\bar" → [ "C:", "foo", "bar" ], with rebuilt absolutes
  if (/^[A-Za-z]:/.test(p)) {
    const parts = p.split(/[\\/]+/).filter(Boolean)
    const out: { label: string; absolute: string }[] = []
    let cur = ""
    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        cur = parts[i] + "\\"
        out.push({ label: parts[i], absolute: cur })
      } else {
        cur = cur + parts[i] + "\\"
        out.push({ label: parts[i], absolute: cur.slice(0, -1) })
      }
    }
    return out
  }
  // POSIX: "/foo/bar" → [ "/", "foo", "bar" ]
  const parts = p.split("/").filter(Boolean)
  const out: { label: string; absolute: string }[] = [{ label: "/", absolute: "/" }]
  let cur = ""
  for (const part of parts) {
    cur = cur + "/" + part
    out.push({ label: part, absolute: cur })
  }
  return out
}

/**
 * Path editor input. Mounts only while `editMode` is true in the parent,
 * so `useState(initialPath)` gives a fresh draft on each edit session —
 * avoiding the setState-in-effect anti-pattern that `path` syncing would
 * otherwise require.
 */
function PathEditor({
  initialPath,
  onCommit,
  onCancel,
}: {
  initialPath: string
  onCommit: (path: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialPath)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = useCallback(() => {
    if (draft && draft !== initialPath) {
      onCommit(draft)
      return
    }
    onCancel()
  }, [draft, initialPath, onCommit, onCancel])

  return (
    <div className="flex h-9 items-center gap-1 px-3">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        className={cn(
          "h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2",
          "font-mono text-xs outline-none focus:border-primary",
        )}
        placeholder="/absolute/path/or/C:\\path"
        aria-label="Navigate to path"
      />
      <button
        onClick={commit}
        className="rounded-md p-1.5 hover:bg-muted"
        aria-label="Go to path"
        type="button"
      >
        <CheckIcon className="size-4" />
      </button>
    </div>
  )
}

export function BreadcrumbPathBar(props: BreadcrumbPathBarProps) {
  const { path, onNavigate, editMode, onRequestEditMode } = props

  if (editMode) {
    return (
      <PathEditor
        initialPath={path ?? ""}
        onCommit={(p) => {
          onNavigate(p)
          onRequestEditMode(false)
        }}
        onCancel={() => onRequestEditMode(false)}
      />
    )
  }

  const segments = path ? splitSegments(path) : []
  return (
    <div
      className="flex h-10 items-center gap-0.5 overflow-x-auto px-3"
      role="navigation"
      aria-label="Path breadcrumb"
    >
      {segments.length === 0 && (
        <span className="text-xs text-muted-foreground">(no location)</span>
      )}
      {segments.map((seg, i) => {
        const last = i === segments.length - 1
        return (
          <div key={seg.absolute} className="flex items-center">
            {i > 0 && (
              <ChevronRightIcon className="mx-0.5 size-3 shrink-0 text-muted-foreground/40" />
            )}
            <button
              type="button"
              onClick={() => onNavigate(seg.absolute)}
              aria-current={last ? "page" : undefined}
              className={cn(
                "max-w-[180px] truncate rounded-md px-2 py-1 text-xs transition-colors",
                last
                  ? "bg-muted/60 font-semibold text-foreground"
                  : "text-foreground/70 hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {seg.label}
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onRequestEditMode(true)}
        className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Edit path (Ctrl+L)"
        title="Edit path (Ctrl+L)"
      >
        <PencilIcon className="size-3.5" />
      </button>
    </div>
  )
}
