import type { EditorRecentFile, EditorTab } from "@/lib/editor-store"
import {
  normalizeEditorPath,
  workspaceRelativeEditorPath,
} from "@/lib/editor-path"

export interface EditorRecentFileItem {
  filePath: string
  relativePath: string
  fileName: string
  language: string
  line: number
  column: number
}

export interface BuildEditorRecentFileItemsInput {
  projectPath: string
  recentFiles: readonly EditorRecentFile[]
  tabs: readonly EditorTab[]
  limit?: number
}

const DEFAULT_RECENT_FILE_LIMIT = 8

export function buildEditorRecentFileItems({
  projectPath,
  recentFiles,
  tabs,
  limit = DEFAULT_RECENT_FILE_LIMIT,
}: BuildEditorRecentFileItemsInput): EditorRecentFileItem[] {
  const openPaths = new Set(tabs.filter(tab => !tab.diff).map((tab) => pathKey(tab.filePath)))
  const seen = new Set<string>()
  const items: EditorRecentFileItem[] = []

  for (const file of recentFiles) {
    if (items.length >= Math.max(0, limit)) break
    const key = pathKey(file.filePath)
    if (openPaths.has(key) || seen.has(key)) continue
    const relativePath = workspaceRelativeEditorPath(projectPath, file.filePath)
    if (relativePath === null) continue
    seen.add(key)
    items.push({
      filePath: file.filePath,
      relativePath,
      fileName: file.fileName,
      language: file.language,
      line: Math.max(1, file.line),
      column: Math.max(1, file.column),
    })
  }

  return items
}

function pathKey(path: string): string {
  return normalizeEditorPath(path).toLowerCase()
}
