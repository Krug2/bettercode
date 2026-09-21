import { resolveThreadRuntimePath } from "@/lib/thread-context"

export interface EditorWorkspaceThread {
  id: string
  projectPath?: string | null
  worktreePath?: string | null
  archived?: boolean
}

export function editorWorkspaceKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "")
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized
}

export function selectEditorWorkspaceThread<T extends EditorWorkspaceThread>(
  threads: readonly T[],
  rememberedPath: string | null,
  rememberedThreadId?: string | null
): T | null {
  const candidates = threads.filter(
    (thread) => !thread.archived && resolveThreadRuntimePath(thread)
  )
  const selected = candidates.find((thread) => thread.id === rememberedThreadId)
  if (
    selected &&
    (!rememberedPath ||
      editorWorkspaceKey(resolveThreadRuntimePath(selected)!) ===
        editorWorkspaceKey(rememberedPath))
  )
    return selected
  if (rememberedPath) {
    const remembered = candidates.find(
      (thread) =>
        editorWorkspaceKey(resolveThreadRuntimePath(thread)!) ===
        editorWorkspaceKey(rememberedPath)
    )
    if (remembered) return remembered
  }
  return candidates[0] ?? null
}
