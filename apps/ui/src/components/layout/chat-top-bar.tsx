import { FolderOpenIcon } from "lucide-react"
import { resolveThreadRuntimePath } from "@/lib/thread-context"

/**
 * Slim header above the chat area. Agent mode renders nothing — sidebar
 * toggle and new-chat actions live in the tab-strip toolbar. Editor mode
 * just shows the current project path so the user knows which folder the
 * editor + chat are scoped to.
 */
export function ChatTopBar({
  appMode,
  activeThread,
}: {
  appMode: "agent" | "editor" | "design"
  activeThread: {
    id: string
    title: string
    projectName?: string
    projectPath?: string | null
    worktreePath?: string | null
  } | null
  activeThreadId: string | null
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}) {
  const projectPath = resolveThreadRuntimePath(activeThread)
  if (appMode !== "editor" || !activeThread || !projectPath) return null

  const normalized = projectPath.replace(/\\/g, "/")
  const folderName = normalized.split("/").filter(Boolean).pop() ?? normalized

  return (
    <header
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border/40 px-3 text-xs"
      title={projectPath}
    >
      <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">
        {activeThread.title || "Chat"}
      </span>
      <FolderOpenIcon
        className="size-3 shrink-0 text-muted-foreground/60"
        strokeWidth={1.75}
      />
      <span className="max-w-[45%] truncate text-[11px] text-muted-foreground">
        {folderName}
      </span>
    </header>
  )
}
