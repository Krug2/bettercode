import { beforeEach, describe, expect, it } from "vitest"
import {
  countEditorDiagnostics,
  normalizeMonacoMarkerSeverity,
  selectAllEditorDiagnostics,
  useEditorDiagnosticsStore,
  type EditorDiagnostic,
} from "@/lib/editor-diagnostics-store"

beforeEach(() => {
  useEditorDiagnosticsStore.getState().clearAllDiagnostics()
})

describe("editor diagnostics store", () => {
  it("normalizes Monaco severities", () => {
    expect(normalizeMonacoMarkerSeverity(8)).toBe("error")
    expect(normalizeMonacoMarkerSeverity(4)).toBe("warning")
    expect(normalizeMonacoMarkerSeverity(2)).toBe("info")
    expect(normalizeMonacoMarkerSeverity(1)).toBe("hint")
  })

  it("stores diagnostics by normalized file path and clears empty updates", () => {
    const diagnostic = makeDiagnostic({
      filePath: "/repo/src/App.tsx",
      severity: "warning",
    })
    useEditorDiagnosticsStore
      .getState()
      .setFileDiagnostics("\\repo\\src\\App.tsx", [diagnostic])

    expect(useEditorDiagnosticsStore.getState().diagnosticsByFile).toEqual({
      "/repo/src/App.tsx": [{ ...diagnostic, filePath: "/repo/src/App.tsx" }],
    })

    useEditorDiagnosticsStore
      .getState()
      .setFileDiagnostics("/repo/src/App.tsx", [])

    expect(useEditorDiagnosticsStore.getState().diagnosticsByFile).toEqual({})
  })

  it("sorts diagnostics by severity, path, and location", () => {
    const diagnostics = [
      makeDiagnostic({
        filePath: "/repo/src/b.ts",
        severity: "warning",
        startLineNumber: 4,
      }),
      makeDiagnostic({
        filePath: "/repo/src/a.ts",
        severity: "error",
        startLineNumber: 8,
      }),
      makeDiagnostic({
        filePath: "/repo/src/a.ts",
        severity: "error",
        startLineNumber: 2,
      }),
    ]

    expect(
      selectAllEditorDiagnostics({
        "/repo/src/b.ts": [diagnostics[0]],
        "/repo/src/a.ts": [diagnostics[1], diagnostics[2]],
      }).map((diagnostic) => [
        diagnostic.filePath,
        diagnostic.severity,
        diagnostic.startLineNumber,
      ])
    ).toEqual([
      ["/repo/src/a.ts", "error", 2],
      ["/repo/src/a.ts", "error", 8],
      ["/repo/src/b.ts", "warning", 4],
    ])
  })

  it("counts diagnostics by severity", () => {
    expect(
      countEditorDiagnostics([
        makeDiagnostic({ severity: "error" }),
        makeDiagnostic({ severity: "warning" }),
        makeDiagnostic({ severity: "warning" }),
        makeDiagnostic({ severity: "hint" }),
      ])
    ).toEqual({ error: 1, warning: 2, info: 0, hint: 1 })
  })
})

function makeDiagnostic(
  overrides: Partial<EditorDiagnostic> = {}
): EditorDiagnostic {
  const filePath = overrides.filePath ?? "/repo/src/file.ts"
  const startLineNumber = overrides.startLineNumber ?? 1
  const startColumn = overrides.startColumn ?? 1
  return {
    id: `${filePath}:${startLineNumber}:${startColumn}`,
    filePath,
    severity: "error",
    message: "Expected token",
    startLineNumber,
    startColumn,
    endLineNumber: overrides.endLineNumber ?? startLineNumber,
    endColumn: overrides.endColumn ?? startColumn + 1,
    ...overrides,
  }
}
