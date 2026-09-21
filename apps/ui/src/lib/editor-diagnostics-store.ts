import { create } from "zustand"

export type EditorDiagnosticSeverity = "error" | "warning" | "info" | "hint"

export interface EditorDiagnostic {
  id: string
  filePath: string
  severity: EditorDiagnosticSeverity
  message: string
  source?: string
  code?: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

interface EditorDiagnosticsState {
  diagnosticsByFile: Record<string, EditorDiagnostic[]>
  setFileDiagnostics: (
    filePath: string,
    diagnostics: EditorDiagnostic[]
  ) => void
  clearFileDiagnostics: (filePath: string) => void
  clearAllDiagnostics: () => void
}

const SEVERITY_RANK: Record<EditorDiagnosticSeverity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
}

export const useEditorDiagnosticsStore = create<EditorDiagnosticsState>(
  (set) => ({
    diagnosticsByFile: {},
    setFileDiagnostics: (filePath, diagnostics) =>
      set((state) => {
        const normalizedPath = normalizePath(filePath)
        if (diagnostics.length === 0) {
          const { [normalizedPath]: _removed, ...rest } =
            state.diagnosticsByFile
          return { diagnosticsByFile: rest }
        }
        return {
          diagnosticsByFile: {
            ...state.diagnosticsByFile,
            [normalizedPath]: diagnostics.map((diagnostic) => ({
              ...diagnostic,
              filePath: normalizedPath,
            })),
          },
        }
      }),
    clearFileDiagnostics: (filePath) =>
      set((state) => {
        const { [normalizePath(filePath)]: _removed, ...rest } =
          state.diagnosticsByFile
        return { diagnosticsByFile: rest }
      }),
    clearAllDiagnostics: () => set({ diagnosticsByFile: {} }),
  })
)

export function selectAllEditorDiagnostics(
  diagnosticsByFile: Record<string, EditorDiagnostic[]>
): EditorDiagnostic[] {
  return Object.values(diagnosticsByFile)
    .flat()
    .sort((a, b) => {
      const severityDelta =
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      if (severityDelta !== 0) return severityDelta
      const fileDelta = a.filePath.localeCompare(b.filePath, undefined, {
        sensitivity: "base",
      })
      if (fileDelta !== 0) return fileDelta
      if (a.startLineNumber !== b.startLineNumber) {
        return a.startLineNumber - b.startLineNumber
      }
      return a.startColumn - b.startColumn
    })
}

export function countEditorDiagnostics(
  diagnostics: readonly EditorDiagnostic[]
): Record<EditorDiagnosticSeverity, number> {
  return diagnostics.reduce(
    (counts, diagnostic) => {
      counts[diagnostic.severity] += 1
      return counts
    },
    { error: 0, warning: 0, info: 0, hint: 0 }
  )
}

export function normalizeMonacoMarkerSeverity(
  severity: number
): EditorDiagnosticSeverity {
  if (severity >= 8) return "error"
  if (severity >= 4) return "warning"
  if (severity >= 2) return "info"
  return "hint"
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/")
}
