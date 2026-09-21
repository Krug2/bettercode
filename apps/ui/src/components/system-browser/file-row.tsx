import { memo } from "react"
import { LinkIcon, StarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { EntryIcon } from "./file-icon"

export interface FileRowProps {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number | null
  mtime: number | null
  selected: boolean
  isFavorite: boolean
  onToggleFavorite: () => void
  matchScore?: number
  parentHint?: string
  onClick: () => void
  onDoubleClick: () => void
  ariaPosInSet: number
  ariaSetSize: number
  id: string
  height: number
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Relative time format à la Finder/VSCode:
 *  <60s     "just now"
 *  <60min   "12 min ago"
 *  today    "14:23"
 *  yesterday "Yesterday"
 *  this week "Mon"
 *  this year "May 4"
 *  older    "2024-08-12"
 */
function formatMtime(ms: number | null): string {
  if (ms === null) return ""
  const now = Date.now()
  const diff = now - ms
  if (diff < 60_000) return "just now"
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  }
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  if (diff < 7 * 24 * 60 * 60_000) return SHORT_DAYS[d.getDay()] ?? ""
  if (d.getFullYear() === today.getFullYear()) {
    return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function FileRowInner(props: FileRowProps) {
  const {
    name,
    isDir,
    isSymlink,
    size,
    mtime,
    selected,
    isFavorite,
    onToggleFavorite,
    parentHint,
    onClick,
    onDoubleClick,
    id,
    height,
  } = props
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-posinset={props.ariaPosInSet}
      aria-setsize={props.ariaSetSize}
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ height }}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2 mx-1 text-sm",
        "cursor-pointer select-none",
        "transition-colors",
        selected
          ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/30"
          : "text-foreground/90 hover:bg-muted/50",
      )}
    >
      <EntryIcon name={name} isDir={isDir} />
      <span className={cn("flex-1 truncate", isDir && "font-medium")}>
        {name}
        {isSymlink && (
          <LinkIcon className="ml-1.5 inline size-3 text-muted-foreground/70" />
        )}
      </span>
      {parentHint !== undefined && parentHint !== "" && (
        <span className="hidden max-w-[35%] truncate font-mono text-[10.5px] text-muted-foreground md:inline">
          {parentHint}
        </span>
      )}
      {isDir && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite()
          }}
          className={cn(
            "shrink-0 rounded p-1 transition-colors",
            isFavorite
              ? "text-yellow-500 hover:bg-yellow-500/10"
              : "text-muted-foreground/30 opacity-0 hover:bg-muted hover:text-muted-foreground group-hover:opacity-100",
            selected && !isFavorite && "opacity-50",
          )}
          aria-label={isFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
          title={isFavorite ? "Unfavorite" : "Favorite"}
        >
          <StarIcon className={cn("size-3.5", isFavorite && "fill-yellow-500")} />
        </button>
      )}
      <span
        className={cn(
          "hidden w-[68px] shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground sm:inline",
          isDir && "opacity-0",
        )}
      >
        {!isDir ? formatSize(size) : "—"}
      </span>
      <span className="hidden w-[88px] shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground md:inline">
        {formatMtime(mtime)}
      </span>
    </div>
  )
}

export const FileRow = memo(FileRowInner)
