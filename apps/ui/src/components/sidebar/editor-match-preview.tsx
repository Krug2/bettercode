import { cn } from "@/lib/utils"

interface EditorMatchPreviewProps {
  preview: string
  matchColumn?: number | null
  matchLength?: number | null
  className?: string
}

export function EditorMatchPreview({
  preview,
  matchColumn,
  matchLength,
  className,
}: EditorMatchPreviewProps) {
  const start = Math.max(0, Math.min(preview.length, (matchColumn ?? 1) - 1))
  const length = Math.max(0, matchLength ?? 0)
  const end = Math.max(start, Math.min(preview.length, start + length))

  if (!preview || length <= 0 || end <= start) {
    return (
      <span
        className={cn(
          "line-clamp-2 min-w-0 font-mono text-[10px] leading-relaxed text-sidebar-foreground/88 group-hover:text-sidebar-foreground",
          className
        )}
      >
        {preview}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "line-clamp-2 min-w-0 font-mono text-[10px] leading-relaxed text-sidebar-foreground/88 group-hover:text-sidebar-foreground",
        className
      )}
    >
      {preview.slice(0, start)}
      <mark className="rounded-sm bg-primary/18 px-0.5 text-sidebar-foreground ring-1 ring-primary/25">
        {preview.slice(start, end)}
      </mark>
      {preview.slice(end)}
    </span>
  )
}
