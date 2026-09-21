import { normalizeEditorPath } from "./editor-path"

export interface FileTreeDropTarget {
  directory: string
  rowPath: string | null
  placement: "inside" | "before" | "after"
}

export function resolveFileTreeDropTarget({
  path,
  kind,
  top,
  height,
  clientY,
}: {
  path: string
  kind: "file" | "folder"
  top: number
  height: number
  clientY: number
}): FileTreeDropTarget {
  const rowPath = normalizeEditorPath(path)
  const parent = rowPath.split("/").slice(0, -1).join("/")
  const offset = clientY - top
  const edgeSize = Math.min(10, Math.round(height * 0.28))

  // Generous edge zones make sibling drops possible without aiming at a gap
  // between adjacent rows. Only a folder's center means moving into it.
  const placement = offset < edgeSize
    ? "before"
    : offset >= height - edgeSize
      ? "after"
      : kind === "folder"
        ? "inside"
        : offset < height / 2 ? "before" : "after"

  return {
    directory: placement === "inside" ? rowPath : parent,
    rowPath,
    placement,
  }
}
