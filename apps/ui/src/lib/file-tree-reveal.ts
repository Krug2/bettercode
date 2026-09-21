import {
  editorPathAncestors,
  isAbsoluteEditorPath,
  normalizeEditorPath,
  workspaceRelativeEditorPath,
} from "@/lib/editor-path"

export interface FileTreeRevealTarget {
  relativePath: string
  ancestorPaths: string[]
}

export function resolveFileTreeRevealTarget(
  projectPath: string,
  targetPath: string
): FileTreeRevealTarget | null {
  const relative =
    workspaceRelativeEditorPath(projectPath, targetPath) ??
    (isAbsoluteEditorPath(targetPath)
      ? null
      : normalizeEditorPath(targetPath).replace(/^\/+/, ""))
  const relativePath = relative?.replace(/\/+$/, "") ?? ""
  if (!relativePath) return null

  return {
    relativePath,
    ancestorPaths: editorPathAncestors(relativePath),
  }
}
