import { normalizeEditorPath, workspaceRelativeEditorPath } from "@/lib/editor-path"

export interface ProjectTreeEntry {
  name: string
  path: string
  type: "file" | "folder"
  children?: ProjectTreeEntry[]
}

interface DirectoryEntryLike {
  name: string
  path: string
  isDir: boolean
}

export function projectDirectoryEntries(
  projectPath: string,
  entries: readonly DirectoryEntryLike[]
): ProjectTreeEntry[] {
  const result: ProjectTreeEntry[] = []
  for (const entry of entries) {
    const relativePath = workspaceRelativeEditorPath(
      projectPath,
      normalizeEditorPath(entry.path)
    )
    if (!relativePath) continue
    result.push({
      name: entry.name,
      path: relativePath,
      type: entry.isDir ? "folder" : "file",
      children: entry.isDir ? [] : undefined,
    })
  }
  return result
}

export function mergeProjectTreeChildren<T extends ProjectTreeEntry>(
  entries: readonly T[],
  parentPath: string,
  children: readonly ProjectTreeEntry[]
): T[] {
  return entries.map((entry) => {
    if (entry.path === parentPath && entry.type === "folder") {
      return { ...entry, children: [...children] }
    }
    if (!entry.children?.length) return entry
    const nextChildren = mergeProjectTreeChildren(
      entry.children,
      parentPath,
      children
    )
    return nextChildren.every((child, index) => child === entry.children?.[index])
      ? entry
      : { ...entry, children: nextChildren }
  })
}
