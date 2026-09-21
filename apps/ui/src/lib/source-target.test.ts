import { describe, expect, it } from "vitest"
import {
  parseSourceReference,
  resolveSourceTarget,
  type SourceOpenTarget,
} from "@/lib/source-target"

describe("parseSourceReference", () => {
  it("parses workspace file, line, column, and range references", () => {
    expect(parseSourceReference("app.ts:6")).toEqual({
      kind: "file",
      filePath: "app.ts",
      line: 6,
      column: 1,
    })
    expect(parseSourceReference("src/app.ts:12:4")).toEqual({
      kind: "file",
      filePath: "src/app.ts",
      line: 12,
      column: 4,
    })
    expect(parseSourceReference("src/app.ts:12:4-18:9")).toEqual({
      kind: "file",
      filePath: "src/app.ts",
      line: 12,
      column: 4,
      endLine: 18,
      endColumn: 9,
    })
  })

  it("keeps Windows drive prefixes while parsing numeric suffixes", () => {
    expect(parseSourceReference("C:\\repo\\src\\app.ts:7:3")).toEqual({
      kind: "file",
      filePath: "C:/repo/src/app.ts",
      line: 7,
      column: 3,
    })
  })

  it("parses line fragments, multiline ranges, and symbols", () => {
    expect(parseSourceReference("src/app.ts#L12C4-L18C9")).toEqual({
      kind: "file",
      filePath: "src/app.ts",
      line: 12,
      column: 4,
      endLine: 18,
      endColumn: 9,
    })
    expect(
      parseSourceReference("src/app.ts#symbol=render%20application")
    ).toEqual({
      kind: "symbol",
      filePath: "src/app.ts",
      symbol: "render application",
    })
  })

  it("parses file URLs without treating them as external browser URLs", () => {
    expect(parseSourceReference("file:///C:/repo/src/My%20File.ts#L9")).toEqual(
      {
        kind: "file",
        filePath: "C:/repo/src/My File.ts",
        line: 9,
        column: 1,
      }
    )
  })

  it("accepts only credential-free HTTP(S) external URLs", () => {
    expect(parseSourceReference("https://example.test/docs?q=source")).toEqual({
      kind: "external",
      url: "https://example.test/docs?q=source",
    })
    expect(parseSourceReference("javascript:alert(1)")).toBeNull()
    expect(parseSourceReference("data:text/plain,hello")).toBeNull()
    expect(parseSourceReference("tel:123")).toBeNull()
    expect(parseSourceReference("https://user:secret@example.test")).toBeNull()
  })

  it("does not turn ordinary inline identifiers into file targets", () => {
    expect(
      parseSourceReference("renderApplication", { requirePathSignal: true })
    ).toBeNull()
    expect(
      parseSourceReference("src/render-application.ts:4", {
        requirePathSignal: true,
      })
    ).toMatchObject({ kind: "file", line: 4 })
    expect(
      parseSourceReference("Dockerfile", { requirePathSignal: true })
    ).toMatchObject({ kind: "file", filePath: "Dockerfile" })
  })
})

describe("resolveSourceTarget", () => {
  const workspacePath = "C:/repo"

  it("resolves relative files within the workspace", () => {
    expect(
      resolveSourceTarget(
        {
          kind: "file",
          filePath: "src/app.ts",
          line: 12,
          column: 4,
        },
        { workspacePath }
      )
    ).toEqual({
      kind: "file",
      filePath: "C:/repo/src/app.ts",
      line: 12,
      column: 4,
    })
  })

  it("retains typed symbol metadata and resolved coordinates", () => {
    expect(
      resolveSourceTarget(
        {
          kind: "symbol",
          filePath: "src/app.ts",
          symbol: "renderApp",
          line: 20,
          column: 3,
          endLine: 20,
          endColumn: 12,
        },
        { workspacePath }
      )
    ).toEqual({
      kind: "symbol",
      filePath: "C:/repo/src/app.ts",
      symbol: "renderApp",
      line: 20,
      column: 3,
      endLine: 20,
      endColumn: 12,
    })
  })

  it("rejects traversal and absolute files outside the workspace", () => {
    expect(
      resolveSourceTarget(
        { kind: "file", filePath: "../secret.txt" },
        { workspacePath }
      )
    ).toBeNull()
    expect(
      resolveSourceTarget(
        { kind: "file", filePath: "C:/other/secret.txt" },
        { workspacePath }
      )
    ).toBeNull()
  })

  it("requires an explicit trusted escape hatch outside a workspace", () => {
    const target: SourceOpenTarget = {
      kind: "file",
      filePath: "C:/other/readme.md",
    }
    expect(resolveSourceTarget(target)).toBeNull()
    expect(
      resolveSourceTarget(target, { allowOutsideWorkspace: true })
    ).toEqual(target)
  })

  it("revalidates typed external targets", () => {
    expect(
      resolveSourceTarget({
        kind: "external",
        url: "https://example.test/docs",
      })
    ).toEqual({
      kind: "external",
      url: "https://example.test/docs",
    })
    expect(
      resolveSourceTarget({
        kind: "external",
        url: "https://user:secret@example.test",
      })
    ).toBeNull()
    expect(
      resolveSourceTarget({
        kind: "external",
        url: "javascript:alert(1)",
      })
    ).toBeNull()
  })

  it("rejects invalid and reversed locations", () => {
    expect(
      resolveSourceTarget(
        { kind: "file", filePath: "src/app.ts", line: 0 },
        { workspacePath }
      )
    ).toBeNull()
    expect(
      resolveSourceTarget(
        {
          kind: "file",
          filePath: "src/app.ts",
          line: 12,
          column: 4,
          endLine: 10,
          endColumn: 1,
        },
        { workspacePath }
      )
    ).toBeNull()
  })
})
