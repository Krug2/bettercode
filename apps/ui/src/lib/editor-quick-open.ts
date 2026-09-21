import type { EditorRecentFile, EditorTab } from "@/lib/editor-store"
import {
  normalizeEditorPath,
  resolveWorkspaceFilePath,
  workspaceRelativeEditorPath,
} from "@/lib/editor-path"
import type { WorkspaceQuickOpenFile } from "@/services/backend/workspaceApi"

export type EditorQuickOpenItemSource =
  | "active"
  | "open"
  | "recent"
  | "history"
  | "workspace"

export interface EditorQuickOpenItem {
  id: string
  filePath: string
  relativePath: string
  name: string
  source: EditorQuickOpenItemSource
  isDirty: boolean
  isPinned: boolean
  isPreview: boolean
  line?: number
  column?: number
}

export interface EditorQuickOpenParsedQuery {
  searchQuery: string
  line?: number
  column?: number
}

export interface BuildEditorQuickOpenItemsInput {
  projectPath: string
  query: string
  workspaceFiles: readonly WorkspaceQuickOpenFile[]
  tabs: readonly EditorTab[]
  activeTabId: string | null
  recentlyClosedTabs: readonly EditorTab[]
  recentFiles?: readonly EditorRecentFile[]
  limit?: number
}

const DEFAULT_LIMIT = 80

export function buildEditorQuickOpenItems({
  projectPath,
  query,
  workspaceFiles,
  tabs,
  activeTabId,
  recentlyClosedTabs,
  recentFiles = [],
  limit = DEFAULT_LIMIT,
}: BuildEditorQuickOpenItemsInput): EditorQuickOpenItem[] {
  const parsedQuery = parseEditorQuickOpenQuery(query)
  const trimmedQuery = normalizeQuery(parsedQuery.searchQuery)
  const scored: Array<{ item: EditorQuickOpenItem; score: number }> = []
  const seen = new Set<string>()
  const targetLine = parsedQuery.line
  const targetColumn = parsedQuery.column

  const addTab = (
    tab: EditorTab,
    source: EditorQuickOpenItemSource,
    index: number
  ) => {
    if (tab.diff) return
    const relativePath = toDisplayPath(projectPath, tab.filePath)
    const matchScore = scoreQuickOpenCandidate(trimmedQuery, {
      name: tab.fileName,
      path: relativePath,
    })
    if (matchScore === null) return
    const isActive = tab.id === activeTabId
    const base = source === "active" ? 4000 : source === "open" ? 3600 : 2600
    const stateBoost =
      (tab.isPinned ? 80 : 0) +
      (tab.isDirty ? 60 : 0) -
      (tab.isPreview ? 20 : 0)
    addScored(
      {
        id: `${source}:${tab.filePath}`,
        filePath: tab.filePath,
        relativePath,
        name: tab.fileName,
        source: isActive ? "active" : source,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isPreview: tab.isPreview,
        line: targetLine ?? tab.cursorLine,
        column: targetColumn ?? tab.cursorColumn,
      },
      base + stateBoost + matchScore - index,
      seen,
      scored
    )
  }

  const addRecentFile = (file: EditorRecentFile, index: number) => {
    const relativePath = toDisplayPath(projectPath, file.filePath)
    const matchScore = scoreQuickOpenCandidate(trimmedQuery, {
      name: file.fileName,
      path: relativePath,
    })
    if (matchScore === null) return
    addScored(
      {
        id: `history:${file.filePath}`,
        filePath: file.filePath,
        relativePath,
        name: file.fileName,
        source: "history",
        isDirty: false,
        isPinned: false,
        isPreview: false,
        line: targetLine ?? file.line,
        column: targetColumn ?? file.column,
      },
      2200 + matchScore - index,
      seen,
      scored
    )
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  if (activeTab) addTab(activeTab, "active", 0)
  tabs
    .filter((tab) => tab.id !== activeTabId)
    .forEach((tab, index) => addTab(tab, "open", index))
  recentlyClosedTabs.forEach((tab, index) => addTab(tab, "recent", index))
  recentFiles.forEach((file, index) => addRecentFile(file, index))

  workspaceFiles.forEach((file, index) => {
    const relativePath = normalizeEditorPath(file.path).replace(/^\/+/, "")
    const matchScore = scoreQuickOpenCandidate(trimmedQuery, {
      name: file.name,
      path: relativePath,
    })
    if (matchScore === null) return
    addScored(
      {
        id: `workspace:${relativePath}`,
        filePath: resolveWorkspaceFilePath(projectPath, relativePath),
        relativePath,
        name: file.name,
        source: "workspace",
        isDirty: false,
        isPinned: false,
        isPreview: false,
        ...(targetLine ? { line: targetLine, column: targetColumn ?? 1 } : {}),
      },
      1200 + matchScore - index,
      seen,
      scored
    )
  })

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.relativePath.localeCompare(b.item.relativePath)
    )
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item)
}

export function parseEditorQuickOpenQuery(
  query: string
): EditorQuickOpenParsedQuery {
  const trimmed = query.trim()
  if (!trimmed) return { searchQuery: "" }

  const match = trimmed.match(/^(.*?)(?:\s*:\s*(\d+))(?:\s*:\s*(\d+))?\s*$/)
  if (!match) return { searchQuery: trimmed }

  const searchQuery = match[1]?.trim()
  const line = Number.parseInt(match[2] ?? "", 10)
  const column = match[3] ? Number.parseInt(match[3], 10) : 1
  if (!searchQuery || !isPositiveSafeInteger(line)) {
    return { searchQuery: trimmed }
  }
  if (!isPositiveSafeInteger(column)) {
    return { searchQuery: trimmed }
  }

  return { searchQuery, line, column }
}

function addScored(
  item: EditorQuickOpenItem,
  score: number,
  seen: Set<string>,
  scored: Array<{ item: EditorQuickOpenItem; score: number }>
): void {
  const key = normalizeEditorPath(item.filePath).toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  scored.push({ item, score })
}

function toDisplayPath(projectPath: string, filePath: string): string {
  return (
    workspaceRelativeEditorPath(projectPath, filePath) ??
    normalizeEditorPath(filePath)
  )
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\\/g, "/")
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function scoreQuickOpenCandidate(
  query: string,
  candidate: { name: string; path: string }
): number | null {
  if (!query) return 0
  const name = candidate.name.toLowerCase()
  const path = candidate.path.toLowerCase()
  if (name === query) return 1000
  if (path === query) return 950
  if (name.startsWith(query)) return 880
  if (path.startsWith(query)) return 820
  const nameIndex = name.indexOf(query)
  if (nameIndex >= 0) return 720 - nameIndex
  const pathIndex = path.indexOf(query)
  if (pathIndex >= 0) return 620 - pathIndex
  const fuzzy = scoreSubsequence(query, path)
  return fuzzy === null ? null : fuzzy
}

function scoreSubsequence(query: string, path: string): number | null {
  let queryIndex = 0
  let gapPenalty = 0
  for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
    if (path[pathIndex] !== query[queryIndex]) continue
    if (queryIndex > 0) gapPenalty += pathIndex
    queryIndex += 1
    if (queryIndex === query.length) {
      return Math.max(120, 420 - gapPenalty)
    }
  }
  return null
}
