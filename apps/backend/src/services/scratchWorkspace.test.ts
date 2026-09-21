import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  copyScratchWorkspaceInto,
  ensureScratchWorkspace,
  isScratchWorkspacePath,
  scratchWorkspacePathFor,
  scratchWorkspaceRoot,
} from "./scratchWorkspace"

const cleanup: string[] = []

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-scratch-"))
  cleanup.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("scratchWorkspacePathFor", () => {
  it("derives a stable per-thread path", () => {
    const dataDir = tempDataDir()
    const first = scratchWorkspacePathFor(dataDir, "thread-1")
    expect(first).toBe(path.join(scratchWorkspaceRoot(dataDir), "thread-1"))
    // Derived, not stored — the same thread must always resolve identically.
    expect(scratchWorkspacePathFor(dataDir, "thread-1")).toBe(first)
  })

  // The thread id becomes a path segment, so a traversal in it would escape
  // the scratch tree and defeat the containment check that authorizes it.
  it("refuses ids that are not safe path segments", () => {
    const dataDir = tempDataDir()
    for (const id of [
      "../escape",
      "a/b",
      "a\\b",
      "",
      "   ",
      "with space",
      "..",
    ]) {
      expect(scratchWorkspacePathFor(dataDir, id), id).toBeNull()
    }
  })
})

describe("isScratchWorkspacePath", () => {
  it("accepts the scratch tree and rejects everything else", () => {
    const dataDir = tempDataDir()
    const root = scratchWorkspaceRoot(dataDir)
    expect(isScratchWorkspacePath(dataDir, root)).toBe(true)
    expect(isScratchWorkspacePath(dataDir, path.join(root, "thread-1"))).toBe(
      true
    )
    expect(
      isScratchWorkspacePath(dataDir, path.join(root, "thread-1", "src"))
    ).toBe(true)

    expect(isScratchWorkspacePath(dataDir, dataDir)).toBe(false)
    expect(isScratchWorkspacePath(dataDir, path.join(dataDir, "logs"))).toBe(
      false
    )
    expect(
      isScratchWorkspacePath(dataDir, path.join(root, "..", "betterc0de.db"))
    ).toBe(false)
    expect(isScratchWorkspacePath(dataDir, os.homedir())).toBe(false)
  })
})

describe("ensureScratchWorkspace", () => {
  it("creates the directory and returns a real path", async () => {
    const dataDir = tempDataDir()
    const created = await ensureScratchWorkspace(dataDir, "thread-abc")
    expect(created).toBeTruthy()
    expect(fs.statSync(created as string).isDirectory()).toBe(true)
    // Must survive the containment check that authorizes it as a workspace.
    expect(isScratchWorkspacePath(fs.realpathSync(dataDir), created as string)).toBe(
      true
    )
  })

  it("returns null for an unsafe thread id without creating anything", async () => {
    const dataDir = tempDataDir()
    expect(await ensureScratchWorkspace(dataDir, "../evil")).toBeNull()
    expect(fs.existsSync(scratchWorkspaceRoot(dataDir))).toBe(false)
  })
})

describe("copyScratchWorkspaceInto", () => {
  it("copies files and nested directories into the repository", async () => {
    const dataDir = tempDataDir()
    const scratch = (await ensureScratchWorkspace(dataDir, "t1")) as string
    fs.writeFileSync(path.join(scratch, "main.py"), "print('hi')")
    fs.mkdirSync(path.join(scratch, "src", "deep"), { recursive: true })
    fs.writeFileSync(path.join(scratch, "src", "deep", "util.py"), "x = 1")

    const repo = tempDataDir()
    const result = await copyScratchWorkspaceInto(scratch, repo)

    expect(result.copied).toBe(2)
    expect(result.skipped).toEqual([])
    expect(fs.readFileSync(path.join(repo, "main.py"), "utf8")).toBe(
      "print('hi')"
    )
    expect(
      fs.readFileSync(path.join(repo, "src", "deep", "util.py"), "utf8")
    ).toBe("x = 1")
  })

  // The destination is the user's repository. Losing their work to deliver a
  // convenience would be worse than not copying at all.
  it("never overwrites an existing file and reports it", async () => {
    const dataDir = tempDataDir()
    const scratch = (await ensureScratchWorkspace(dataDir, "t2")) as string
    fs.writeFileSync(path.join(scratch, "README.md"), "from scratch")
    fs.writeFileSync(path.join(scratch, "new.txt"), "fresh")

    const repo = tempDataDir()
    fs.writeFileSync(path.join(repo, "README.md"), "ORIGINAL")

    const result = await copyScratchWorkspaceInto(scratch, repo)

    expect(fs.readFileSync(path.join(repo, "README.md"), "utf8")).toBe(
      "ORIGINAL"
    )
    expect(result.copied).toBe(1)
    expect(result.skipped).toEqual(["README.md"])
  })

  it("preserves a destination file created concurrently with the copy", async () => {
    const scratch = (await ensureScratchWorkspace(tempDataDir(), "copy-race")) as string
    fs.writeFileSync(path.join(scratch, "new.txt"), "from scratch")
    const repo = tempDataDir()
    const copyFile = fsPromises.copyFile.bind(fsPromises)
    vi.spyOn(fsPromises, "copyFile").mockImplementationOnce(async (source, target, mode) => {
      fs.writeFileSync(target, "CONCURRENT USER FILE")
      await copyFile(source, target, mode)
    })

    const result = await copyScratchWorkspaceInto(scratch, repo)

    expect(fs.readFileSync(path.join(repo, "new.txt"), "utf8")).toBe("CONCURRENT USER FILE")
    expect(result).toEqual({ copied: 0, skipped: ["new.txt"], truncated: false })
  })

  it("skips destination directory links and file collisions", async () => {
    const scratch = (await ensureScratchWorkspace(tempDataDir(), "copy-links")) as string
    for (const name of ["linked", "occupied"]) {
      fs.mkdirSync(path.join(scratch, name))
      fs.writeFileSync(path.join(scratch, name, "new.txt"), "from scratch")
    }
    const repo = tempDataDir()
    const outside = tempDataDir()
    fs.symlinkSync(outside, path.join(repo, "linked"), process.platform === "win32" ? "junction" : "dir")
    fs.writeFileSync(path.join(repo, "occupied"), "ORIGINAL")

    const result = await copyScratchWorkspaceInto(scratch, repo)

    expect(result).toEqual({ copied: 0, skipped: ["linked", "occupied"], truncated: false })
    expect(fs.readdirSync(outside)).toEqual([])
    expect(fs.readFileSync(path.join(repo, "occupied"), "utf8")).toBe("ORIGINAL")
  })

  it("is a no-op when the chat never used its scratch workspace", async () => {
    const dataDir = tempDataDir()
    const repo = tempDataDir()
    const result = await copyScratchWorkspaceInto(
      path.join(scratchWorkspaceRoot(dataDir), "never-used"),
      repo
    )
    expect(result).toEqual({ copied: 0, skipped: [], truncated: false })
    expect(fs.readdirSync(repo)).toEqual([])
  })

  it("skips node_modules and .git and reports a file-count cap", async () => {
    const dataDir = tempDataDir()
    const scratch = (await ensureScratchWorkspace(dataDir, "capped-copy-thread")) as string
    fs.mkdirSync(path.join(scratch, "node_modules", "pkg"), { recursive: true })
    fs.writeFileSync(path.join(scratch, "node_modules", "pkg", "index.js"), "x")
    fs.mkdirSync(path.join(scratch, ".git"), { recursive: true })
    fs.writeFileSync(path.join(scratch, ".git", "HEAD"), "ref")
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      fs.writeFileSync(path.join(scratch, name), name)
    }

    const repo = tempDataDir()
    const result = await copyScratchWorkspaceInto(scratch, repo, { maxFiles: 2 })

    expect(result.copied).toBe(2)
    expect(result.truncated).toBe(true)
    expect(fs.existsSync(path.join(repo, "node_modules"))).toBe(false)
    expect(fs.existsSync(path.join(repo, ".git"))).toBe(false)
  })

  it("stops at the byte cap without writing a partial file", async () => {
    const dataDir = tempDataDir()
    const scratch = (await ensureScratchWorkspace(dataDir, "t4")) as string
    fs.writeFileSync(path.join(scratch, "a-small.txt"), "1234")
    fs.writeFileSync(path.join(scratch, "z-big.txt"), "x".repeat(100))

    const repo = tempDataDir()
    const result = await copyScratchWorkspaceInto(scratch, repo, { maxBytes: 50 })

    expect(result.truncated).toBe(true)
    expect(result.copied).toBe(1)
    expect(fs.existsSync(path.join(repo, "z-big.txt"))).toBe(false)
    expect(fs.readFileSync(path.join(repo, "a-small.txt"), "utf8")).toBe("1234")
  })
})
