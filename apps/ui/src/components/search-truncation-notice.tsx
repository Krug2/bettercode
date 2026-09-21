import { TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { searchTruncationMessage } from "@/lib/search-truncation"

interface SearchTruncationNoticeProps {
  truncated: boolean
  reason?: string
  /** What was cut short, e.g. "Results", "File list", "Scan". */
  subject?: string
  /** What the user can do about it. */
  hint?: string
  className?: string
}

/**
 * Compact, static row shown at the end of a search result list when the
 * backend reports `truncated: true`. Renders nothing otherwise — a consumer
 * can always mount it unconditionally and let the flag decide.
 *
 * Deliberately no animation and no colour beyond the muted text: the point
 * is that a partial list stops looking like a complete one, not to alarm.
 */
export function SearchTruncationNotice({
  truncated,
  reason,
  subject,
  hint,
  className,
}: SearchTruncationNoticeProps) {
  if (!truncated) return null
  return (
    <p
      role="note"
      data-search-truncated={reason ?? "unknown"}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground",
        className
      )}
    >
      <TriangleAlertIcon
        className="size-3 shrink-0 text-muted-foreground/70"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        {searchTruncationMessage({ subject, reason, hint })}
      </span>
    </p>
  )
}
