import type { ChatThread } from "@betterc0de/schema"
import type { CreateThreadOptions } from "@/lib/chat/types"

type ThreadContextSource = Pick<
  ChatThread,
  | "projectName"
  | "projectPath"
  | "envMode"
  | "branch"
  | "worktreePath"
  | "baseBranch"
  | "worktreeState"
>

interface ThreadRuntimePathSource {
  readonly projectPath?: string | null
  readonly worktreePath?: string | null
  readonly envMode?: string | null
}

export interface NewThreadContext {
  projectName: string
  projectPath?: string
  options?: CreateThreadOptions
}

export function resolveThreadRuntimePath(
  thread: ThreadRuntimePathSource | null | undefined
): string | null {
  if (!thread) return null
  const worktreePath = normalizePath(thread.worktreePath)
  if (worktreePath) return worktreePath
  const projectPath = normalizePath(thread.projectPath)
  return projectPath || null
}

export function resolveNewThreadContext(input: {
  selectedPath?: string | null
  activeThread?: ThreadContextSource | null
}): NewThreadContext {
  const selectedPath = normalizePath(input.selectedPath)
  if (selectedPath) {
    return {
      projectName: basename(selectedPath) || "Project",
      projectPath: selectedPath,
    }
  }

  const activeThread = input.activeThread
  if (!activeThread) return { projectName: "BetterC0de" }

  const projectPath = normalizePath(activeThread.projectPath)
  return {
    projectName: activeThread.projectName || basename(projectPath) || "BetterC0de",
    ...(projectPath ? { projectPath } : {}),
    options: {
      envMode: activeThread.envMode ?? (activeThread.worktreePath ? "worktree" : "local"),
      branch: activeThread.branch ?? null,
      worktreePath: activeThread.worktreePath ?? null,
      baseBranch: activeThread.baseBranch ?? null,
      worktreeState:
        activeThread.worktreeState ??
        (activeThread.worktreePath ? "ready" : "none"),
    },
  }
}

function normalizePath(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

function basename(value: string): string {
  if (!value) return ""
  return value.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? ""
}
