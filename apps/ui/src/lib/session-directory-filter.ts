export interface SessionDirectoryThread {
  id: string
  projectPath?: string | null
  worktreePath?: string | null
}

export function filterThreadsForSessionDirectory<T extends SessionDirectoryThread>(
  threads: readonly T[],
  activeThreadId: string | null | undefined,
  enabled: boolean
): T[] {
  if (!enabled || !activeThreadId) return [...threads]
  const active = threads.find((thread) => thread.id === activeThreadId)
  const activeKeys = sessionDirectoryKeys(active)
  if (activeKeys.length === 0) return [...threads]
  return threads.filter((thread) =>
    sessionDirectoryKeys(thread).some((key) => activeKeys.includes(key))
  )
}

export function sessionDirectoryKeys(
  thread: SessionDirectoryThread | null | undefined
): string[] {
  if (!thread) return []
  return unique(
    [thread.projectPath, thread.worktreePath]
      .map(normalizeSessionDirectoryPath)
      .filter((value): value is string => Boolean(value))
  )
}

function normalizeSessionDirectoryPath(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\\/g, "/").replace(/\/+$/g, "")
  return normalized ? normalized.toLowerCase() : null
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
