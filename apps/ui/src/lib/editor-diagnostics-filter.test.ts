import { describe, expect, it } from "vitest"
import { filterEditorDiagnostics } from "@/lib/editor-diagnostics-filter"
import type { EditorDiagnostic } from "@/lib/editor-diagnostics-store"

describe("filterEditorDiagnostics", () => {
  it("filters diagnostics by severity", () => {
    const diagnostics = [
      makeDiagnostic({ severity: "error", message: "Cannot find name User" }),
      makeDiagnostic({ severity: "warning", message: "Unused import" }),
    ]

    expect(
      filterEditorDiagnostics(diagnostics, {
        severity: "error",
        query: "",
      }).map((diagnostic) => diagnostic.message)
    ).toEqual(["Cannot find name User"])
  })

  it("matches query terms across message, file path, source, and code", () => {
    const diagnostics = [
      makeDiagnostic({
        filePath: "/repo/src/App.tsx",
        message: "Cannot find name UserCard",
        source: "ts",
        code: "2304",
      }),
      makeDiagnostic({
        filePath: "/repo/src/styles.css",
        message: "Unknown property",
        source: "css",
        code: "unknownProperties",
      }),
    ]

    expect(
      filterEditorDiagnostics(diagnostics, {
        severity: "all",
        query: "app usercard 2304",
      }).map((diagnostic) => diagnostic.filePath)
    ).toEqual(["/repo/src/App.tsx"])
  })

  it("matches line and column tokens", () => {
    const diagnostics = [
      makeDiagnostic({
        filePath: "/repo/src/App.tsx",
        startLineNumber: 17,
        startColumn: 9,
      }),
    ]

    expect(
      filterEditorDiagnostics(diagnostics, {
        severity: "all",
        query: "17:9",
      })
    ).toHaveLength(1)
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
