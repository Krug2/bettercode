export interface GoToLineTarget {
  line: number
  column: number
}

export const EDITOR_GOTO_LINE_EVENT = "betterc0de:editor-goto-line"

export interface EditorGotoLineDetail extends GoToLineTarget {
  filePath?: string
  endLine?: number
  endColumn?: number
  preserveNavigation?: boolean
}

export function dispatchEditorGotoLine(
  detail: EditorGotoLineDetail,
  options: { defer?: boolean } = {}
): void {
  if (typeof window === "undefined") return
  const dispatch = () => {
    window.dispatchEvent(
      new CustomEvent(EDITOR_GOTO_LINE_EVENT, {
        detail,
      })
    )
  }
  if (options.defer) {
    window.setTimeout(dispatch, 0)
    return
  }
  dispatch()
}

export interface GoToLineQueryContext {
  currentLine?: number
  currentColumn?: number
  maxLine?: number
}

export function parseGoToLineQuery(
  input: string,
  context: GoToLineQueryContext = {}
): GoToLineTarget | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const relativeMatch = trimmed.match(/^([+-])\s*(\d+)(?:\s*[:,]\s*(\d+))?$/)
  if (relativeMatch) {
    const currentLine = safePositiveInteger(context.currentLine)
    if (!currentLine) return null
    const delta = Number.parseInt(relativeMatch[2]!, 10)
    const column = relativeMatch[3]
      ? Number.parseInt(relativeMatch[3], 10)
      : (safePositiveInteger(context.currentColumn) ?? 1)
    if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(column)) {
      return null
    }
    if (column < 1) return null
    const sign = relativeMatch[1] === "-" ? -1 : 1
    return {
      line: clampLine(currentLine + sign * delta, context.maxLine),
      column,
    }
  }

  const match = trimmed.match(/^(\d+)(?:\s*[:,]\s*(\d+))?$/)
  if (!match) return null

  const line = Number.parseInt(match[1]!, 10)
  const column = match[2] ? Number.parseInt(match[2], 10) : 1
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return null
  if (line < 1 || column < 1) return null

  return { line: clampLine(line, context.maxLine), column }
}

export function countEditorLines(content: string): number {
  if (!content) return 1
  return content.split(/\r\n|\r|\n/).length
}

function clampLine(line: number, maxLine: number | undefined): number {
  const upper = safePositiveInteger(maxLine)
  if (!upper) return line
  return Math.min(Math.max(1, line), upper)
}

function safePositiveInteger(value: number | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isSafeInteger(value) || value < 1) return null
  return value
}
