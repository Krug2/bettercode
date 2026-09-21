import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { diff } from "./diff"
import { invalidateStatusCache, status } from "./status"

describe("Git read probes do not execute repository helpers", () => {
  let root: string
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      windowsHide: true,
      stdio: "pipe",
      timeout: 10_000,
    })
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-git-read-"))
    git("init")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.invalid")
    fs.writeFileSync(path.join(root, "note.txt"), "original\n")
    git("add", "note.txt")
    git(
      "-c",
      "core.hooksPath=",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "-m",
      "initial"
    )
    fs.writeFileSync(path.join(root, "note.txt"), "changed\n")
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

  it("does not invoke FSMonitor for status", async () => {
    git("config", "core.fsmonitor", "sh .git/probe.sh")
    await status(root)
    expect(fs.existsSync(path.join(root, ".git", "executed"))).toBe(false)
  })

  it.each(["external", "textconv", "clean", "process"] as const)(
    "does not invoke %s for diff",
    async (kind) => {
      if (kind === "external")
        git("config", "diff.external", "sh .git/probe.sh")
      if (kind === "textconv") {
        git("config", "diff.probe.textconv", "sh .git/probe.sh")
        fs.writeFileSync(
          path.join(root, ".gitattributes"),
          "note.txt diff=probe\n"
        )
      }
      if (kind === "clean") {
        git("config", "filter.probe.clean", "sh .git/probe.sh")
        fs.writeFileSync(
          path.join(root, ".gitattributes"),
          "note.txt filter=probe\n"
        )
      }
      if (kind === "process") {
        git("config", "filter.probe.process", "sh .git/probe.sh")
        git("config", "filter.probe.required", "true")
        fs.writeFileSync(
          path.join(root, ".gitattributes"),
          "note.txt filter=probe\n"
        )
      }
      await diff(root)
      expect(fs.existsSync(path.join(root, ".git", "executed"))).toBe(false)
    }
  )
})
