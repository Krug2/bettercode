import { PencilIcon, FileIcon as LucideFileIcon } from "lucide-react"

/**
 * UI card shown in the message list for "Inline edit (…) in <path>: <prompt>"
 * messages. Parsing happens in `@/lib/message-utils#parseInlineEditMessage`
 * — this component just renders the structured result as a labeled chip
 * row with the user's instruction below.
 */
export function InlineEditMessageCard({
  range,
  filePath,
  instruction,
}: {
  range: string
  filePath: string
  instruction: string
}) {
  // Strip Windows UNC prefix and extract the file name for the chip label.
  const cleanPath = filePath.replace(/^\\\\\?\\/, "")
  const fileName =
    cleanPath
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() || cleanPath

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary">
          <PencilIcon className="size-3" />
          Inline Edit
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          title={cleanPath}
        >
          <LucideFileIcon className="size-2.5" />
          {fileName}
        </span>
        <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {range}
        </span>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {instruction}
      </p>
    </div>
  )
}
