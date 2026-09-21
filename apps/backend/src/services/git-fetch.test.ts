import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fetchRemote, status } from "./git"

let root: string
const git = (cwd: string, ...args: string[]) => execFileSync("git", [
  "-c", "user.name=Fetch Test", "-c", "user.email=fetch@example.test",
  "-c", "commit.gpgsign=false", ...args,
], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "betterc0de-fetch-test-")) })
afterEach(async () => {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("betterc0de-fetch-test-")) throw new Error("Unexpected test directory")
  await fs.rm(root, { recursive: true, force: true })
})

describe("fetch remote updates", () => {
  it("reports new incoming commits without changing HEAD, the index, or local files", async () => {
    const remote = path.join(root, "remote.git")
    const writer = path.join(root, "writer")
    const reader = path.join(root, "reader")
    git(root, "init", "--bare", "--initial-branch=main", remote)
    git(root, "clone", remote, writer)
    await fs.writeFile(path.join(writer, "file.txt"), "initial\n")
    git(writer, "add", ".")
    git(writer, "commit", "-m", "Initial")
    git(writer, "push", "-u", "origin", "main")
    git(root, "clone", remote, reader)
    // Only this isolated fixture uses a local-path remote.
    git(reader, "config", "protocol.file.allow", "always")
    await fs.writeFile(path.join(reader, "local.txt"), "keep staged work\n")
    git(reader, "add", "local.txt")
    const head = git(reader, "rev-parse", "HEAD")
    const index = git(reader, "diff", "--cached")
    const workingFile = await fs.readFile(path.join(reader, "file.txt"), "utf8")
    expect((await status(reader)).behind).toBe(0)

    await fs.writeFile(path.join(writer, "file.txt"), "incoming change\n")
    git(writer, "commit", "-am", "Remote update")
    git(writer, "push")
    const result = await fetchRemote(reader)
    expect(result.status).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 1, staged: ["local.txt"] })
    expect(git(reader, "rev-parse", "HEAD")).toBe(head)
    expect(git(reader, "diff", "--cached")).toBe(index)
    expect(await fs.readFile(path.join(reader, "file.txt"), "utf8")).toBe(workingFile)
    expect(await fs.readFile(path.join(reader, "local.txt"), "utf8")).toBe("keep staged work\n")
  })

  it("returns an actionable error when no remote exists", async () => {
    git(root, "init")
    await expect(fetchRemote(root)).rejects.toMatchObject({ statusCode: 400, code: "git_remote_error", message: expect.stringContaining("No remote configured") })
  })

  it("reports an unreachable remote instead of a successful check", async () => {
    git(root, "init")
    git(root, "remote", "add", "origin", path.join(root, "missing.git"))
    git(root, "config", "protocol.file.allow", "always")
    await expect(fetchRemote(root)).rejects.toMatchObject({ statusCode: 400, code: "git_remote_error", message: "Remote repository not reachable." })
  })
})
