import { GitBranchIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "@/components/error-boundary"
import { GitPanel } from "@/components/git-panel"

/**
 * Dialog wrapper around the reusable {@link GitPanel}, shown from the
 * chat toolbar's "Git" button in agent mode.
 *
 * Wrapped in an `ErrorBoundary` because GitPanel performs live shell
 * calls per-render (branches, status, diff) — if the project directory
 * goes away or the git binary errors out, we want to contain the failure
 * so the rest of the app keeps working.
 */
export function SourceControlDialog({
  open,
  onOpenChange,
  projectPath,
  minimalChat,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string | undefined
  minimalChat: boolean
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
        <DialogTitle className="sr-only">Source Control</DialogTitle>
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border/40",
            minimalChat ? "px-3 py-2" : "px-4 py-2.5"
          )}
        >
          <GitBranchIcon className="size-4 text-muted-foreground" />
          <span
            className={cn(
              "font-medium",
              minimalChat ? "text-xs" : "text-sm"
            )}
          >
            Source Control
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {projectPath && (
            <ErrorBoundary label="Git">
              <GitPanel cwd={projectPath} appMode="agent" />
            </ErrorBoundary>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
