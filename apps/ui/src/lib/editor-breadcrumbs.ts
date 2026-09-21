import {
  normalizeEditorPath,
  relativeEditorPath,
  resolveWorkspaceFilePath,
  workspaceRelativeEditorPath,
} from "@/lib/editor-path"

export interface EditorBreadcrumbSegment {
  label: string
  kind: "folder" | "file"
  relativePath: string
  absolutePath: string
  revealable: boolean
}

/**
 * A root-level file alone adds no information below the editor tab and reads
 * as a duplicated tab. Nested folders and outline symbols still benefit from
 * the breadcrumb row.
 */
export function shouldShowEditorBreadcrumbs(
  segmentCount: number,
  outlineItemCount: number
): boolean {
  return segmentCount > 1 || outlineItemCount > 0
}

export function buildEditorBreadcrumbSegments(
  projectPath: string | null | undefined,
  filePath: string
): EditorBreadcrumbSegment[] {
  const displayPath = relativeEditorPath(projectPath, filePath)
  const labels = displayPath.split("/").filter(Boolean)
  if (labels.length === 0) return []

  const workspaceRelative = workspaceRelativeEditorPath(projectPath, filePath)
  const revealable = workspaceRelative !== null

  return labels.map((label, index) => {
    const relativePath = labels.slice(0, index + 1).join("/")
    const isFile = index === labels.length - 1
    return {
      label,
      kind: isFile ? "file" : "folder",
      relativePath,
      absolutePath:
        revealable && projectPath
          ? resolveWorkspaceFilePath(projectPath, relativePath)
          : isFile
            ? filePath
            : normalizeEditorPath(relativePath),
      revealable,
    }
  })
}
