import { describe, expect, it } from "vitest"
import {
  buildDiagnosticBatchFixAction,
  buildDiagnosticBatchFixInstruction,
  buildDiagnosticFixInstruction,
} from "@/lib/editor-diagnostic-actions"
import type { EditorDiagnostic } from "@/lib/editor-diagnostics-store"

describe("editor diagnostic actions", () => {
  it("builds a focused single-diagnostic AI fix instruction", () => {
    expect(
      buildDiagnosticFixInstruction(
        diagnostic({
          severity: "warning",
          startLineNumber: 7,
          startColumn: 12,
          message: "Unused variable",
          source: "ts",
          code: "6133",
        })
      )
    ).toContain("Fix this warning at line 7, column 12.")
  })

  it("builds a batch action spanning all diagnostics in one file", () => {
    const action = buildDiagnosticBatchFixAction([
      diagnostic({
        filePath: "/repo/src/app.ts",
        startLineNumber: 10,
        startColumn: 8,
        endLineNumber: 10,
        endColumn: 15,
        message: "Second issue",
      }),
      diagnostic({
        filePath: "/repo/src/app.ts",
        startLineNumber: 3,
        startColumn: 2,
        endLineNumber: 5,
        endColumn: 9,
        message: "First issue",
      }),
    ])

    expect(action).toMatchObject({
      filePath: "/repo/src/app.ts",
      line: 3,
      column: 2,
      endLine: 10,
      endColumn: 15,
    })
    expect(action?.instruction).toContain("Fix these 2 editor diagnostics")
    expect(action?.instruction).toContain("1. error L3:C2-L5:C9")
    expect(action?.instruction).toContain("2. error L10:C8-L10:C15")
  })

  it("ignores diagnostics from other files when building a file action", () => {
    const action = buildDiagnosticBatchFixAction([
      diagnostic({ filePath: "/repo/src/a.ts", message: "A" }),
      diagnostic({ filePath: "/repo/src/b.ts", message: "B" }),
    ])

    expect(action?.filePath).toBe("/repo/src/a.ts")
    expect(action?.instruction).toContain("Fix these 1 editor diagnostics")
    expect(action?.instruction).not.toContain("B")
  })

  it("summarizes long diagnostic batches", () => {
    const instruction = buildDiagnosticBatchFixInstruction(
      Array.from({ length: 14 }, (_, index) =>
        diagnostic({ message: `Issue ${index + 1}` })
      )
    )

    expect(instruction).toContain("Issue 12")
    expect(instruction).not.toContain("Issue 13")
    expect(instruction).toContain("...and 2 more diagnostics in this file.")
  })
})

function diagnostic(
  overrides: Partial<EditorDiagnostic> = {}
): EditorDiagnostic {
  const filePath = overrides.filePath ?? "/repo/src/file.ts"
  const startLineNumber = overrides.startLineNumber ?? 1
  const startColumn = overrides.startColumn ?? 1
  return {
    id: `${filePath}:${startLineNumber}:${startColumn}`,
    filePath,
    severity: overrides.severity ?? "error",
    message: overrides.message ?? "Expected token",
    source: overrides.source,
    code: overrides.code,
    startLineNumber,
    startColumn,
    endLineNumber: overrides.endLineNumber ?? startLineNumber,
    endColumn: overrides.endColumn ?? startColumn + 1,
  }
}
