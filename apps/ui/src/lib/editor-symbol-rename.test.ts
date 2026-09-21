import { afterEach, expect, it } from "vitest"
import ts from "typescript"
import {
  planSymbolRename,
  type RenameDocument,
  type SymbolRenameWorker,
} from "./editor-symbol-rename"

const services: ts.LanguageService[] = []
afterEach(() => {
  services.splice(0).forEach((service) => service.dispose())
})
function document(uri: string, content: string): RenameDocument {
  return {
    uri,
    snapshot: {
      id: uri,
      filePath: uri,
      content,
      revision: 1,
      documentVersion: 1,
    },
  }
}
function worker(documents: readonly RenameDocument[]): SymbolRenameWorker {
  const files = new Map(
    documents.map((document) => [document.uri, document.snapshot.content])
  )
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowJs: true,
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const content = files.get(name)
      return content === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => "/repo",
    getDefaultLibFileName: () => "/lib.d.ts",
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
  })
  services.push(service)
  return {
    getRenameInfo: async (...args) => service.getRenameInfo(...args),
    findRenameLocations: async (...args) =>
      service.findRenameLocations(...args),
  }
}

it("renames the selected binding without touching shadowed names, strings or comments", async () => {
  const content =
    'const count = 1;\nfunction f(count: number) { return count }\n// count\nconst text = "count";\nconst value = count;'
  const documents = [document("/repo/a.ts", content)]
  const result = await planSymbolRename({
    worker: worker(documents),
    documents,
    currentUri: "/repo/a.ts",
    offset: 7,
    newName: "total",
  })
  expect(result.status).toBe("ready")
  if (result.status !== "ready") throw new Error(result.reason)
  expect(result.replacements).toBe(2)
  expect(result.changes[0].content).toBe(
    content
      .replace("const count", "const total")
      .replace("value = count", "value = total")
  )
})

it.each(["/repo", "file:///repo", "file:///c%3A/repo"])(
  "follows imports and preserves shorthand keys with URI root %s",
  async (root) => {
    const documents = [
      document(`${root}/a.ts`, "export const count = 1;"),
      document(
        `${root}/b.ts`,
        'import { count } from "./a"; const object = { count };'
      ),
    ]
    const result = await planSymbolRename({
      worker: worker(documents),
      documents,
      currentUri: `${root}/a.ts`,
      offset: 14,
      newName: "total",
    })
    if (result.status !== "ready") throw new Error(result.reason)
    expect(result.changes.map((change) => change.content)).toEqual(
      expect.arrayContaining([
        "export const total = 1;",
        'import { total } from "./a"; const object = { count: total };',
      ])
    )
    expect(result.guards).toHaveLength(2)
  }
)

it("refuses edits to a file outside the captured scope rather than applying a partial rename", async () => {
  const all = [
    document("/repo/a.ts", "export const count = 1;"),
    document("/repo/b.ts", 'import { count } from "./a"; count;'),
  ]
  const result = await planSymbolRename({
    worker: worker(all),
    documents: all.slice(0, 1),
    currentUri: "/repo/a.ts",
    offset: 14,
    newName: "total",
  })
  expect(result).toMatchObject({
    status: "rejected",
    reason: expect.stringContaining("/repo/b.ts"),
  })
})

it.each(["class", "bad-name"])(
  "rejects invalid new binding %s before asking the worker",
  async (newName) => {
    const documents = [document("/repo/a.ts", "const count = 1;")]
    expect(
      await planSymbolRename({
        worker: worker(documents),
        documents,
        currentUri: "/repo/a.ts",
        offset: 7,
        newName,
      })
    ).toMatchObject({ status: "rejected" })
  }
)

it("rejects malformed language-service output", async () => {
  const documents = [document("/repo/a.ts", "const count = 1;")]
  const invalidWorker: SymbolRenameWorker = {
    getRenameInfo: async () => ({ canRename: true }),
    findRenameLocations: async () => [],
  }
  await expect(
    planSymbolRename({
      worker: invalidWorker,
      documents,
      currentUri: "/repo/a.ts",
      offset: 7,
      newName: "total",
    })
  ).rejects.toThrow()
})
