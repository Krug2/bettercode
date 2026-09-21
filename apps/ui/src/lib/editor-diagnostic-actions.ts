import type { EditorDiagnostic } from "@/lib/editor-diagnostics-store"

export interface DiagnosticFixAction {
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  instruction: string
}

const MAX_BATCH_DIAGNOSTICS_IN_PROMPT = 12

export function buildDiagnosticFixInstruction(
  diagnostic: EditorDiagnostic
): string {
  return [
    `Fix this ${diagnostic.severity} at line ${diagnostic.startLineNumber}, column ${diagnostic.startColumn}.`,
    `Message: ${diagnostic.message}`,
    diagnostic.source ? `Source: ${diagnostic.source}` : null,
    diagnostic.code ? `Code: ${diagnostic.code}` : null,
    "Make the smallest safe code change required and preserve surrounding behavior.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

export function buildDiagnosticBatchFixAction(
  diagnostics: readonly EditorDiagnostic[]
): DiagnosticFixAction | null {
  if (diagnostics.length === 0) return null
  const filePath = diagnostics[0]?.filePath
  if (!filePath) return null
  const sameFileDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.filePath === filePath
  )
  if (sameFileDiagnostics.length === 0) return null

  const sorted = [...sameFileDiagnostics].sort((a, b) => {
    if (a.startLineNumber !== b.startLineNumber) {
      return a.startLineNumber - b.startLineNumber
    }
    return a.startColumn - b.startColumn
  })
  const start = sorted[0]
  const end = sorted.reduce((latest, diagnostic) => {
    if (diagnostic.endLineNumber > latest.endLineNumber) return diagnostic
    if (
      diagnostic.endLineNumber === latest.endLineNumber &&
      diagnostic.endColumn > latest.endColumn
    ) {
      return diagnostic
    }
    return latest
  }, sorted[0]!)

  return {
    filePath,
    line: Math.max(1, start!.startLineNumber),
    column: Math.max(1, start!.startColumn),
    endLine: Math.max(start!.startLineNumber, end.endLineNumber),
    endColumn: Math.max(1, end.endColumn),
    instruction: buildDiagnosticBatchFixInstruction(sorted),
  }
}

export function buildDiagnosticBatchFixInstruction(
  diagnostics: readonly EditorDiagnostic[]
): string {
  const shown = diagnostics.slice(0, MAX_BATCH_DIAGNOSTICS_IN_PROMPT)
  const hiddenCount = Math.max(0, diagnostics.length - shown.length)
  return [
    `Fix these ${diagnostics.length} editor diagnostics in this file.`,
    "Make the smallest safe code changes required and preserve surrounding behavior.",
    "Diagnostics:",
    ...shown.map(formatDiagnosticListItem),
    hiddenCount > 0
      ? `...and ${hiddenCount} more diagnostics in this file.`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

function formatDiagnosticListItem(
  diagnostic: EditorDiagnostic,
  index: number
): string {
  const code = diagnostic.code ? ` ${diagnostic.code}` : ""
  const source = diagnostic.source ? ` ${diagnostic.source}` : ""
  return `${index + 1}. ${diagnostic.severity} L${diagnostic.startLineNumber}:C${diagnostic.startColumn}-L${diagnostic.endLineNumber}:C${diagnostic.endColumn}${source}${code}: ${diagnostic.message}`
}
