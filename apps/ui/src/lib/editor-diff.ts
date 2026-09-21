import { normalizeEditorPath } from "./editor-path"

export interface EditorDiffTarget {
  cwd: string
  path: string
  source: "staged" | "unstaged"
}

export function editorDiffKey(target: EditorDiffTarget): string {
  const cwd = normalizeEditorPath(target.cwd).replace(/\/+$/, "")
  const key = `${cwd}/${normalizeEditorPath(target.path)}`
  return `${target.source}:${/^(?:[a-z]:|\/\/)/i.test(cwd) ? key.toLowerCase() : key}`
}

export function editorDiffLabel(target: EditorDiffTarget): string {
  return target.source === "staged" ? "Staged" : "Changes"
}
