import { FolderOpenIcon } from "lucide-react"

/**
 * Shared grayed-out state shown in a pane's Terminal/Diff/Files/Git tab when
 * the pane's chat thread has no folder attached.
 */
export function NoFolderEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center opacity-60">
      <FolderOpenIcon
        className="size-8 text-muted-foreground/50"
        strokeWidth={1.25}
      />
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">
          No folder attached
        </p>
        <p className="text-xs text-muted-foreground/70">
          Attach a folder to this chat to enable Terminal, Diff, Files, and Git.
        </p>
      </div>
    </div>
  )
}
