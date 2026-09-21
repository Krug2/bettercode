import { beforeEach, describe, expect, it, vi } from "vitest"
import { listDirectoryFs, type ListResult } from "@/services/backend/filesystem"
import { readFile } from "@/services/backend/workspaceApi"
import { detectDevServerProject } from "./dev-server-project"

vi.mock("@/services/backend/filesystem", () => ({ listDirectoryFs: vi.fn() }))
vi.mock("@/services/backend/workspaceApi", () => ({ readFile: vi.fn() }))

function directory(names: string[]): ListResult {
  return {
    path: "C:/repo", parent: "C:/", truncated: false,
    entries: names.map((name) => ({
      name, path: `C:/repo/${name}`, isDir: false, isSymlink: false,
      size: 1, mtime: null,
    })),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readFile).mockResolvedValue({
    path: "C:/repo/package.json",
    content: JSON.stringify({ scripts: { dev: "vite", start: "vite preview" } }),
  })
})

describe("dev server project detection", () => {
  it.each([
    [[], "npm"],
    [["package-lock.json"], "npm"],
    [["pnpm-lock.yaml", "yarn.lock", "bun.lock"], "pnpm"],
    [["yarn.lock", "bun.lock"], "yarn"],
    [["bun.lock"], "bun"],
    [["bun.lockb"], "bun"],
  ] as const)("detects %j from names without reading lockfile contents", async (lockfiles, packageManager) => {
    vi.mocked(listDirectoryFs).mockResolvedValue(directory(["package.json", ...lockfiles]))

    await expect(detectDevServerProject("C:/repo")).resolves.toEqual({ scriptName: "dev", packageManager })
    expect(listDirectoryFs).toHaveBeenCalledExactlyOnceWith("C:/repo")
    expect(readFile).toHaveBeenCalledExactlyOnceWith("C:/repo/package.json")
  })

  it("does not read an absent manifest or absent lockfiles in a non-Node project", async () => {
    vi.mocked(listDirectoryFs).mockResolvedValue(directory(["README.md", "index.html"]))
    await expect(detectDevServerProject("C:/repo")).resolves.toEqual({ scriptName: null, packageManager: "npm" })
    expect(readFile).not.toHaveBeenCalled()
  })

  it("does not mistake a directory named like a lockfile for a package manager", async () => {
    const listing = directory(["pnpm-lock.yaml"])
    listing.entries[0].isDir = true
    vi.mocked(listDirectoryFs).mockResolvedValue(listing)
    await expect(detectDevServerProject("C:/repo")).resolves.toEqual({ scriptName: null, packageManager: "npm" })
    expect(readFile).not.toHaveBeenCalled()
  })

  it("does not guess a package manager from an incomplete listing", async () => {
    vi.mocked(listDirectoryFs).mockResolvedValue({ ...directory(["package.json"]), truncated: true })
    await expect(detectDevServerProject("C:/repo")).rejects.toThrow("incomplete")
    expect(readFile).not.toHaveBeenCalled()
  })

  it.each(["null", "[]", "not json"])("reports an invalid package manifest: %s", async (content) => {
    vi.mocked(listDirectoryFs).mockResolvedValue(directory(["package.json"]))
    vi.mocked(readFile).mockResolvedValue({ content, path: "C:/repo/package.json" })
    await expect(detectDevServerProject("C:/repo")).rejects.toThrow()
  })

  it("preserves real access errors instead of treating them as missing scripts", async () => {
    const denied = new Error("Workspace access denied")
    vi.mocked(listDirectoryFs).mockRejectedValue(denied)
    await expect(detectDevServerProject("C:/repo")).rejects.toBe(denied)
    expect(readFile).not.toHaveBeenCalled()
  })

  it("keeps each project's paths and launch script independent", async () => {
    vi.mocked(listDirectoryFs).mockResolvedValue(directory(["package.json", "yarn.lock"]))
    vi.mocked(readFile).mockResolvedValue({ path: "D:/other/project/package.json", content: '{"scripts":{"serve":"vite"}}' })
    await expect(detectDevServerProject("D:/other/project")).resolves.toEqual({ scriptName: "serve", packageManager: "yarn" })
    expect(readFile).toHaveBeenCalledExactlyOnceWith("D:/other/project/package.json")
    expect(listDirectoryFs).toHaveBeenCalledExactlyOnceWith("D:/other/project")
  })
})
