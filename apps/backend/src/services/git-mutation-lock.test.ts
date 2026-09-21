import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { KeyedAsyncLock, gitMutationLockKey } from "./git-mutation-lock"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("KeyedAsyncLock", () => {
  it("serialises operations on the same key and releases after a throw", async () => {
    const lock = new KeyedAsyncLock()
    const events: string[] = []
    const gate = deferred()

    const first = lock.withLock("repo", async () => {
      events.push("first:start")
      await gate.promise
      events.push("first:end")
      throw new Error("first failed")
    })
    const second = lock.withLock("repo", () => {
      events.push("second")
      return "done"
    })
    await Promise.resolve()
    expect(events).toEqual(["first:start"])
    expect(lock.size()).toBe(1)

    gate.resolve()
    await expect(first).rejects.toThrow("first failed")
    await expect(second).resolves.toBe("done")
    expect(events).toEqual(["first:start", "first:end", "second"])
    expect(lock.size()).toBe(0)
  })

  it("lets different keys proceed independently", async () => {
    const lock = new KeyedAsyncLock()
    const gate = deferred()
    const events: string[] = []

    const blocked = lock.withLock("a", async () => {
      await gate.promise
      events.push("a")
    })
    await lock.withLock("b", () => {
      events.push("b")
    })
    expect(events).toEqual(["b"])

    gate.resolve()
    await blocked
    expect(events).toEqual(["b", "a"])
  })

  it("excludes nested cwd mutations, distinguishes worktrees, and keeps the initialization key stable", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bc-git-lock-"))
    const root = path.join(directory, "repo")
    fs.mkdirSync(root)
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, windowsHide: true })
    try {
      const beforeInit = await gitMutationLockKey(root)
      git("init")
      const rootKey = await gitMutationLockKey(root)
      expect(rootKey).toBe(beforeInit)
      fs.mkdirSync(path.join(root, "src"))
      const nestedKey = await gitMutationLockKey(path.join(root, "src"))
      expect(nestedKey).toBe(rootKey)
      const lock = new KeyedAsyncLock()
      const gate = deferred()
      const events: string[] = []
      const first = lock.withLock(rootKey, async () => {
        events.push("root")
        await gate.promise
      })
      const second = lock.withLock(nestedKey, () => {
        events.push("nested")
      })
      await Promise.resolve()
      expect(events).toEqual(["root"])
      gate.resolve()
      await Promise.all([first, second])
      expect(events).toEqual(["root", "nested"])
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@localhost",
        "commit",
        "--allow-empty",
        "-m",
        "base"
      )
      const linked = path.join(directory, "linked")
      git("worktree", "add", "-b", "linked", linked)
      expect(await gitMutationLockKey(linked)).not.toBe(rootKey)
      if (process.platform === "win32")
        expect(await gitMutationLockKey(root.toUpperCase())).toBe(rootKey)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
