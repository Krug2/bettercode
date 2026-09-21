import { FolderOpenIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ProjectFileTree } from "@/components/file-tree/project-file-tree"

/**
 * Full-screen-ish file-tree dialog shown from the chat toolbar's "Files"
 * button in agent mode.
 *
 * Wraps {@link ProjectFileTree} — which is a collapsible widget in the
 * right sidebar — in a dialog chrome, with the tree forced open
 * (`open={true}` on the inner collapsible) since the whole dialog *is*
 * the tree view. Selecting a file opens it in the editor and closes the
 * dialog so the user lands in the editor immediately.
 */
export function FileExplorerDialog({
  open,
  onOpenChange,
  projectPath,
  minimalChat,
  onFileSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string | undefined
  minimalChat: boolean
  onFileSelect: (path: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          minimalChat ? "h-[55vh] sm:max-w-sm" : "h-[70vh] sm:max-w-md"
        )}
      >
        <DialogTitle className="sr-only">File Explorer</DialogTitle>
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border/40",
            minimalChat ? "px-3 py-2" : "px-4 py-2.5"
          )}
        >
          <FolderOpenIcon className="size-4 text-muted-foreground" />
          <span
            className={cn(
              "font-medium",
              minimalChat ? "text-xs" : "text-sm"
            )}
          >
            File Explorer
          </span>
          <span className="ml-auto max-w-[200px] truncate font-mono text-[10px] text-muted-foreground">
            {projectPath}
          </span>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            minimalChat ? "p-1.5" : "p-2"
          )}
        >
          {projectPath && (
            <ProjectFileTree
              projectPath={projectPath}
              defaultOpen
              onFileSelect={onFileSelect}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
