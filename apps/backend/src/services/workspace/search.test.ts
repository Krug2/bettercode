import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  quickOpenFiles,
  searchContentDetailed,
  searchEntries,
  searchEntriesDetailed,
  translateNestedGitignore,
  workspaceMap,
} from "./search"

const tempRoots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "betterc0de-search-"))
  tempRoots.push(root)
  return root
}

async function write(root: string, relativePath: string, content = "x\n") {
  const absolutePath = path.join(root, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, content, "utf8")
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe("translateNestedGitignore", () => {
  it("anchors slash patterns to their directory and floats the rest", () => {
    expect(
      translateNestedGitignore(
        "pkg/app",
        ["# comment", "", "dist/", "/local.txt", "src/gen/*.js", "!keep.js", "*.log  "].join("\n")
      )
    ).toEqual([
      "pkg/app/**/dist/",
      "pkg/app/local.txt",
      "pkg/app/src/gen/*.js",
      "!pkg/app/**/keep.js",
      "pkg/app/**/*.log",
    ])
  })
})

describe("nested .gitignore files", () => {
  it("are honoured below their own directory only", async () => {
    const root = await makeRoot()
    await write(root, "sub/.gitignore", "ignored.txt\n/anchored.txt\nbuild/\n")
    await write(root, "sub/ignored.txt")
    await write(root, "sub/deep/ignored.txt")
    await write(root, "sub/anchored.txt")
    await write(root, "sub/deep/anchored.txt")
    await write(root, "sub/build/out.js")
    await write(root, "other/ignored.txt")
    await write(root, "other/build/out.js")

    const entries = (await searchEntries(root, "")).map((entry) => entry.path)
    expect(entries).toContain("sub/deep/anchored.txt")
    expect(entries).toContain("other/ignored.txt")
    expect(entries).toContain("other/build/out.js")
    expect(entries).not.toContain("sub/ignored.txt")
    expect(entries).not.toContain("sub/deep/ignored.txt")
    expect(entries).not.toContain("sub/anchored.txt")
    expect(entries).not.toContain("sub/build/out.js")

    const content = await searchContentDetailed(root, "x")
    const contentPaths = content.results.map((result) => result.path)
    expect(contentPaths).toContain("other/ignored.txt")
    expect(contentPaths).not.toContain("sub/ignored.txt")

    const quick = (await quickOpenFiles(root, "ignored")).map((file) => file.path)
    expect(quick).toEqual(["other/ignored.txt"])

    const map = await workspaceMap(root)
    expect(map.files.map((file) => file.path)).not.toContain("sub/build/out.js")
  })

  // Regression: root and nested rules were two matchers joined with `||`, so
  // a nested `!important.log` could never override a root `*.log`. Git gives
  // the deeper file precedence (last matching rule wins).
  it("let a deeper .gitignore un-ignore what the root ignores", async () => {
    const root = await makeRoot()
    await write(root, ".gitignore", "*.log\n")
    await write(root, "sub/.gitignore", "!important.log\n")
    await write(root, "sub/important.log")
    await write(root, "sub/other.log")
    await write(root, "root.log")
    await write(root, "other/important.log")

    const entries = (await searchEntries(root, "")).map((entry) => entry.path)
    expect(entries).toContain("sub/important.log")
    expect(entries).not.toContain("sub/other.log")
    expect(entries).not.toContain("root.log")
    // The un-ignore is scoped to its own directory.
    expect(entries).not.toContain("other/important.log")

    const quick = (await quickOpenFiles(root, "important")).map((file) => file.path)
    expect(quick).toEqual(["sub/important.log"])
  })

  it("let a deeper .gitignore re-ignore what the root un-ignores", async () => {
    const root = await makeRoot()
    await write(root, ".gitignore", "*.log\n!important.log\n")
    await write(root, "sub/.gitignore", "*.log\n")
    await write(root, "sub/important.log")
    await write(root, "important.log")

    const entries = (await searchEntries(root, "")).map((entry) => entry.path)
    expect(entries).toContain("important.log")
    expect(entries).not.toContain("sub/important.log")
  })

  // Regression: the directory was spliced into the pattern verbatim, so
  // `packages/[legacy]` became a character class and its `.gitignore`
  // matched `packages/l/…` instead of its own tree.
  it("treats glob metacharacters in the directory name literally", async () => {
    expect(translateNestedGitignore("packages/[legacy]", "dist/\n")).toEqual([
      "packages/\\[legacy\\]/**/dist/",
    ])
    expect(translateNestedGitignore("#notes", "/x\n")).toEqual(["\\#notes/x"])
    expect(translateNestedGitignore("!bang", "/x\n")).toEqual(["\\!bang/x"])

    const root = await makeRoot()
    await write(root, "packages/[legacy]/.gitignore", "dist/\n")
    await write(root, "packages/[legacy]/dist/out.js")
    await write(root, "packages/[legacy]/src/index.js")
    await write(root, "packages/l/dist/out.js")

    const entries = (await searchEntries(root, "")).map((entry) => entry.path)
    expect(entries).not.toContain("packages/[legacy]/dist/out.js")
    expect(entries).toContain("packages/[legacy]/src/index.js")
    expect(entries).toContain("packages/l/dist/out.js")
  })

  // Regression: the pattern cache was keyed by the `.gitignore` path alone,
  // but its patterns are translated relative to the search root. Opening
  // `<root>/sub` as a workspace after searching `<root>` reused the
  // `sub/deep/**/…` translation under the new root, where it matched
  // nothing and the nested ignores stopped applying.
  it("translates a nested .gitignore per search root, not per file", async () => {
    const rootA = await makeRoot()
    await write(rootA, "sub/deep/.gitignore", "ignored.txt\n")
    await write(rootA, "sub/deep/ignored.txt")
    await write(rootA, "sub/deep/kept.txt")
    expect((await searchEntries(rootA, ".txt")).map((e) => e.path)).toEqual([
      "sub/deep/kept.txt",
    ])

    // Same file, now reached from a nested root: the cache entry from A
    // must not be served as-is.
    const rootB = path.join(rootA, "sub")
    expect((await searchEntries(rootB, ".txt")).map((e) => e.path)).toEqual([
      "deep/kept.txt",
    ])
    // And going back to A still works.
    expect((await searchEntries(rootA, ".txt")).map((e) => e.path)).toEqual([
      "sub/deep/kept.txt",
    ])
  })

  it("picks up an edited nested .gitignore on the next search", async () => {
    const root = await makeRoot()
    await write(root, "sub/.gitignore", "a.txt\n")
    await write(root, "sub/a.txt")
    await write(root, "sub/b.txt")
    expect((await searchEntries(root, ".txt")).map((e) => e.path)).toEqual([
      "sub/b.txt",
    ])

    // Ensure the mtime moves even on coarse filesystems.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await write(root, "sub/.gitignore", "b.txt\n")
    const now = Date.now()
    await fs.utimes(path.join(root, "sub", ".gitignore"), now / 1000, now / 1000)
    expect((await searchEntries(root, ".txt")).map((e) => e.path)).toEqual([
      "sub/a.txt",
    ])
  })
})

describe("search truncation is reported", () => {
  it("handles overlapping include and exclude globs in quick-open and content search", async () => {
    const root = await makeRoot()
    const name = "a".repeat(240)
    await write(root, name, "needle")
    const pattern = "*a".repeat(16) + "b"
    expect(await quickOpenFiles(root, "", { include: pattern })).toEqual([])
    expect((await searchContentDetailed(root, "needle", { include: pattern })).results).toEqual([])
    expect((await searchContentDetailed(root, "needle", { exclude: pattern })).results)
      .toMatchObject([{ path: name }])
  })

  it("flags a result cap on searchEntriesDetailed", async () => {
    const root = await makeRoot()
    for (let index = 0; index < 6; index += 1) {
      await write(root, `file-${index}.txt`)
    }
    const capped = await searchEntriesDetailed(root, "", { maxResults: 3 })
    expect(capped.entries).toHaveLength(3)
    expect(capped.truncated).toBe(true)
    expect(capped.truncatedReason).toBe("results")

    const full = await searchEntriesDetailed(root, "")
    expect(full.entries).toHaveLength(6)
    expect(full.truncated).toBe(false)
    expect(full.truncatedReason).toBeUndefined()
  })

  it("flags a visited-entries cap and an expired deadline", async () => {
    const root = await makeRoot()
    for (let index = 0; index < 6; index += 1) {
      await write(root, `file-${index}.txt`)
    }
    const visited = await searchEntriesDetailed(root, "", { maxVisited: 2 })
    expect(visited.truncated).toBe(true)
    expect(visited.truncatedReason).toBe("visited")

    const expired = await searchEntriesDetailed(root, "", { maxDurationMs: 0 })
    expect(expired.entries).toEqual([])
    expect(expired.truncated).toBe(true)
    expect(expired.truncatedReason).toBe("deadline")
  })

  it("flags file and byte budgets on searchContentDetailed", async () => {
    const root = await makeRoot()
    for (let index = 0; index < 5; index += 1) {
      await write(root, `f${index}.txt`, "needle\n")
    }
    const files = await searchContentDetailed(root, "needle", {}, { maxScannedFiles: 2 })
    expect(files.results.length).toBeLessThanOrEqual(2)
    expect(files.truncated).toBe(true)
    expect(files.truncatedReason).toBe("files")

    const bytes = await searchContentDetailed(root, "needle", {}, { maxScannedBytes: 8 })
    expect(bytes.truncated).toBe(true)
    expect(bytes.truncatedReason).toBe("bytes")

    const limited = await searchContentDetailed(root, "needle", { limit: 2 })
    expect(limited.results).toHaveLength(2)
    expect(limited.truncated).toBe(true)
    expect(limited.truncatedReason).toBe("limit")

    const complete = await searchContentDetailed(root, "needle")
    expect(complete.results).toHaveLength(5)
    expect(complete.truncated).toBe(false)
  })
})
