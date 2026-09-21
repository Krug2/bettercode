import { FileIcon, XIcon } from "lucide-react"
import {
  PromptInputHeader,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { cn } from "@/lib/utils"

function attachmentName(
  attachment: ReturnType<typeof usePromptInputAttachments>["files"][number]
): string {
  return attachment.filename?.trim() || "Attachment"
}

export function ComposerAttachments({ simple }: { simple: boolean }) {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) return null

  return (
    <PromptInputHeader
      aria-label="Selected attachments"
      className={cn(
        "w-full justify-start gap-1.5",
        simple ? "px-2 pt-2 pb-0" : "px-3 pt-3 pb-0"
      )}
    >
      {attachments.files.map((attachment) => {
        const name = attachmentName(attachment)
        const image = attachment.mediaType?.startsWith("image/")

        return (
          <div
            key={attachment.id}
            className={cn(
              "group/attachment flex h-8 max-w-52 min-w-0 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/55 pr-1 pl-1.5 text-foreground",
              "transition-colors hover:border-border hover:bg-muted/80"
            )}
            title={name}
          >
            {image ? (
              <img
                src={attachment.url}
                alt=""
                className="size-5 shrink-0 rounded object-cover"
              />
            ) : (
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
              {name}
            </span>
            <button
              type="button"
              aria-label={`Remove ${name}`}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
                "transition-colors hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              )}
              onClick={() => attachments.remove(attachment.id)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )
      })}
    </PromptInputHeader>
  )
}
