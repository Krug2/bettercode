import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { stageAll } from "./commands"
import { invalidateStatusCache } from "./status"

describe("Git writes do not execute repository helpers", () => {
  let root: string
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      windowsHide: true,
      stdio: "pipe",
      timeout: 10_000,
    })
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-git-write-"))
    git("init")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.invalid")
    fs.writeFileSync(path.join(root, "note.txt"), "original\n")
    git(
      "-c",
      "core.hooksPath=",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--allow-empty",
      "-m",
      "initial"
    )
    fs.writeFileSync(
      path.join(root, ".git", "probe.sh"),
      "#!/bin/sh\nprintf probe >> .git/executed\ncat\n",
      { mode: 0o700 }
    )
  })
  afterEach(async () => {
    await invalidateStatusCache(root)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("does not invoke a local clean filter while staging", async () => {
    git("config", "filter.probe.clean", "sh .git/probe.sh")
    git("config", "filter.probe.required", "true")
    fs.writeFileSync(path.join(root, ".gitattributes"), "* filter=probe\n")
    fs.writeFileSync(path.join(root, "note.txt"), "changed\n")
    await stageAll(root)
    expect(fs.existsSync(path.join(root, ".git", "executed"))).toBe(false)
  })

  it("does not invoke a local FSMonitor while staging", async () => {
    git("config", "core.fsmonitor", "sh .git/probe.sh")
    fs.writeFileSync(path.join(root, "note.txt"), "changed\n")
    await stageAll(root)
    expect(fs.existsSync(path.join(root, ".git", "executed"))).toBe(false)
  })
})
