import type {
  EditorDiagnostic,
  EditorDiagnosticSeverity,
} from "@/lib/editor-diagnostics-store"

export type EditorDiagnosticsSeverityFilter = EditorDiagnosticSeverity | "all"

export interface EditorDiagnosticsFilterOptions {
  severity: EditorDiagnosticsSeverityFilter
  query: string
}

export function filterEditorDiagnostics(
  diagnostics: readonly EditorDiagnostic[],
  options: EditorDiagnosticsFilterOptions
): EditorDiagnostic[] {
  const query = normalizeQuery(options.query)
  return diagnostics.filter((diagnostic) => {
    if (options.severity !== "all" && diagnostic.severity !== options.severity)
      return false
    if (!query) return true
    return diagnosticMatchesQuery(diagnostic, query)
  })
}

function diagnosticMatchesQuery(
  diagnostic: EditorDiagnostic,
  query: string
): boolean {
  const haystack = [
    diagnostic.filePath,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.source,
    diagnostic.code,
    `${diagnostic.startLineNumber}:${diagnostic.startColumn}`,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase()
  return query
    .split(/\s+/g)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}
