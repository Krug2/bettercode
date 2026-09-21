import { buildCodeOutline, type CodeOutlineItem } from "@/lib/code-outline"
import { getLanguage, type EditorTab } from "@/lib/editor-store"

export interface WorkspaceSymbolSource {
  filePath: string
  relativePath: string
  content: string
}

export interface WorkspaceSymbol {
  id: string
  name: string
  kind: CodeOutlineItem["kind"]
  filePath: string
  relativePath: string
  line: number
  column: number
  detail?: string
}

export interface WorkspaceDefinitionRequest {
  symbol: string
  originFilePath?: string | null
  originLine?: number | null
  originColumn?: number | null
}

export type WorkspaceDefinitionCandidate = WorkspaceSymbol

export interface OpenEditorWorkspaceSymbolSources {
  sources: WorkspaceSymbolSource[]
  sourcePathKeys: Set<string>
}

const MAX_WORKSPACE_SYMBOLS = 120
const MAX_WORKSPACE_DEFINITIONS = 20

export function buildWorkspaceSymbols(
  sources: readonly WorkspaceSymbolSource[],
  query: string
): WorkspaceSymbol[] {
  const needle = normalizeSymbolQuery(query)
  if (!needle) return []

  const symbols: Array<WorkspaceSymbol & { score: number }> = []
  for (const source of sources) {
    const outline = buildCodeOutline({
      content: source.content,
      language: getLanguage(source.filePath),
      fileName: source.relativePath,
    })
    for (const item of outline) {
      const score = scoreWorkspaceSymbol(item, source.relativePath, needle)
      if (score === null) continue
      symbols.push({
        id: `${source.relativePath}:${item.id}`,
        name: item.name,
        kind: item.kind,
        filePath: source.filePath,
        relativePath: source.relativePath,
        line: item.line,
        column: item.column,
        ...(item.detail ? { detail: item.detail } : {}),
        score,
      })
    }
  }

  return symbols
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.name !== b.name) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      }
      return a.relativePath.localeCompare(b.relativePath, undefined, {
        sensitivity: "base",
      })
    })
    .slice(0, MAX_WORKSPACE_SYMBOLS)
    .map(({ score: _score, ...symbol }) => symbol)
}

export function buildWorkspaceDefinitionCandidates(
  sources: readonly WorkspaceSymbolSource[],
  request: WorkspaceDefinitionRequest
): WorkspaceDefinitionCandidate[] {
  const symbol = request.symbol.trim()
  if (!symbol) return []

  const originFilePath = normalizePath(request.originFilePath ?? "")
  const originLine = Number.isFinite(request.originLine)
    ? Number(request.originLine)
    : null
  const originColumn = Number.isFinite(request.originColumn)
    ? Number(request.originColumn)
    : null

  const candidates: Array<WorkspaceDefinitionCandidate & { score: number }> = []
  for (const source of sources) {
    const outline = buildCodeOutline({
      content: source.content,
      language: getLanguage(source.filePath),
      fileName: source.relativePath,
    })
    for (const item of outline) {
      if (item.name !== symbol) continue
      const normalizedFilePath = normalizePath(source.filePath)
      candidates.push({
        id: `${source.relativePath}:${item.id}`,
        name: item.name,
        kind: item.kind,
        filePath: source.filePath,
        relativePath: source.relativePath,
        line: item.line,
        column: item.column,
        ...(item.detail ? { detail: item.detail } : {}),
        score: scoreDefinitionCandidate(item, normalizedFilePath, {
          originFilePath,
          originLine,
          originColumn,
        }),
      })
    }
  }

  return candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.relativePath !== b.relativePath) {
        return a.relativePath.localeCompare(b.relativePath, undefined, {
          sensitivity: "base",
        })
      }
      if (a.line !== b.line) return a.line - b.line
      return a.column - b.column
    })
    .slice(0, MAX_WORKSPACE_DEFINITIONS)
    .map(({ score: _score, ...candidate }) => candidate)
}

export function buildOpenEditorWorkspaceSymbolSources(input: {
  projectPath?: string | null
  currentFilePath: string
  currentContent: string
  tabs: readonly EditorTab[]
}): OpenEditorWorkspaceSymbolSources {
  const currentRelativePath = workspaceSymbolRelativePath(
    input.projectPath,
    input.currentFilePath
  )
  const sources: WorkspaceSymbolSource[] = [
    {
      filePath: input.currentFilePath,
      relativePath: currentRelativePath,
      content: input.currentContent,
    },
  ]
  const sourcePathKeys = new Set<string>([
    workspaceSymbolPathKey(currentRelativePath),
  ])

  for (const tab of input.tabs) {
    if (sameWorkspaceSymbolPath(tab.filePath, input.currentFilePath)) continue
    const relativePath = workspaceSymbolRelativePath(
      input.projectPath,
      tab.filePath
    )
    const key = workspaceSymbolPathKey(relativePath)
    if (sourcePathKeys.has(key)) continue
    sourcePathKeys.add(key)
    sources.push({
      filePath: tab.filePath,
      relativePath,
      content: tab.content,
    })
  }

  return { sources, sourcePathKeys }
}

export function buildOpenEditorWorkspaceSymbolSourcesFromTabs(input: {
  projectPath?: string | null
  tabs: readonly EditorTab[]
}): OpenEditorWorkspaceSymbolSources {
  const sources: WorkspaceSymbolSource[] = []
  const sourcePathKeys = new Set<string>()

  for (const tab of input.tabs) {
    const relativePath = workspaceSymbolRelativePath(
      input.projectPath,
      tab.filePath
    )
    const key = workspaceSymbolPathKey(relativePath)
    if (sourcePathKeys.has(key)) continue
    sourcePathKeys.add(key)
    sources.push({
      filePath: tab.filePath,
      relativePath,
      content: tab.content,
    })
  }

  return { sources, sourcePathKeys }
}

function normalizeSymbolQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function scoreWorkspaceSymbol(
  item: CodeOutlineItem,
  relativePath: string,
  query: string
): number | null {
  const name = item.name.toLowerCase()
  const detail = item.detail?.toLowerCase() ?? ""
  const file = relativePath.toLowerCase()

  if (name === query) return 100_000 - item.depth
  if (name.startsWith(query)) return 90_000 - item.depth
  const nameIndex = name.indexOf(query)
  if (nameIndex >= 0) return 80_000 - nameIndex * 20 - item.depth
  if (detail.includes(query)) return 70_000 - item.depth

  const fuzzy = fuzzyScore(name, query)
  if (fuzzy !== null) return 45_000 + fuzzy - item.depth

  const fileIndex = file.indexOf(query)
  if (fileIndex >= 0) return 25_000 - fileIndex
  return null
}

function fuzzyScore(value: string, query: string): number | null {
  let score = 0
  let searchIndex = 0
  let previousMatch = -1

  for (const char of query) {
    const matchIndex = value.indexOf(char, searchIndex)
    if (matchIndex < 0) return null

    const previousChar = matchIndex > 0 ? value[matchIndex - 1] : ""
    const boundary =
      matchIndex === 0 ||
      previousChar === "-" ||
      previousChar === "_" ||
      previousChar === "."
    score += boundary ? 120 : 40
    if (previousMatch >= 0) {
      score -= Math.min(matchIndex - previousMatch - 1, 12)
    }
    previousMatch = matchIndex
    searchIndex = matchIndex + 1
  }

  return score
}

function scoreDefinitionCandidate(
  item: CodeOutlineItem,
  filePath: string,
  origin: {
    originFilePath: string
    originLine: number | null
    originColumn: number | null
  }
): number {
  let score = 100_000 + definitionKindPriority(item.kind) - item.depth * 25
  const sameFile = Boolean(
    origin.originFilePath && filePath === origin.originFilePath
  )
  if (sameFile) {
    score += 20_000
    if (origin.originLine !== null) {
      const distance = Math.abs(item.line - origin.originLine)
      score += Math.max(0, 5_000 - distance * 20)
      if (item.line <= origin.originLine) score += 500
    }
    if (origin.originColumn !== null && item.line === origin.originLine) {
      score -= Math.abs(item.column - origin.originColumn)
    }
  }
  return score
}

function definitionKindPriority(kind: CodeOutlineItem["kind"]): number {
  switch (kind) {
    case "class":
    case "component":
      return 900
    case "function":
    case "method":
      return 800
    case "interface":
    case "type":
    case "enum":
      return 700
    case "module":
      return 500
    case "selector":
    case "key":
    case "section":
      return 300
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/")
}

function workspaceSymbolRelativePath(
  projectPath: string | null | undefined,
  filePath: string
): string {
  const normalizedFile = normalizePath(filePath)
  if (!projectPath) return normalizedFile
  const normalizedProject = normalizePath(projectPath).replace(/\/+$/, "")
  const projectLower = normalizedProject.toLowerCase()
  const fileLower = normalizedFile.toLowerCase()
  if (fileLower.startsWith(`${projectLower}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1)
  }
  return normalizedFile
}

function workspaceSymbolPathKey(value: string): string {
  return normalizePath(value).toLowerCase()
}

function sameWorkspaceSymbolPath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()
}
