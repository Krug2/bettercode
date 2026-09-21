import { isEditorPathEqualOrInside, normalizeEditorPath } from "./editor-path"
import { AppError, HttpError } from "./errors"

export const FILE_TREE_DRAG_TYPE = "application/x-betterc0de-workspace-entry"

export interface FileTreeMove {
  fromRelativePath: string
  toRelativePath: string
}

export function fileTreeMoveError(error: unknown): string {
  if (error instanceof AppError && error.code === "EEXIST") {
    return "A file or folder with this name already exists in the destination. Nothing was replaced."
  }
  if (error instanceof AppError && error.code === "workspace_untrusted") {
    return "Trust this workspace before moving files or folders."
  }
  if (error instanceof HttpError && error.status === 403) {
    return "Moving is not allowed in this workspace or read-only session."
  }
  return error instanceof Error ? error.message : "Could not move this file or folder."
}

function treePath(value: string): string | null {
  const path = normalizeEditorPath(value).replace(/\/+$/, "")
  if (path.startsWith("/") || /[:\0]/.test(path)) return null
  if (
    path &&
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null
  return path
}

export function resolveFileTreeMove(
  sourcePath: string,
  destinationDirectory: string
): FileTreeMove | null {
  const source = treePath(sourcePath)
  const directory = treePath(destinationDirectory)
  if (!source || directory === null) return null
  if (directory && isEditorPathEqualOrInside(directory, source)) return null
  const name = source.split("/").at(-1)!
  const target = directory ? `${directory}/${name}` : name
  if (source.toLowerCase() === target.toLowerCase()) return null
  return { fromRelativePath: source, toRelativePath: target }
}
