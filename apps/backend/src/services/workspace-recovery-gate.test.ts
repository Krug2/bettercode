import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  WorkspaceRecoveryGate,
  resolveWorkspaceRecoveryScopes,
} from "./workspace-recovery-gate"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe("WorkspaceRecoveryGate", () => {
  it("allows overlapping readers and blocks an overlapping writer", async () => {
    const root = makeDirectory()
    const child = path.join(root, "child")
    fs.mkdirSync(child)
    const gate = new WorkspaceRecoveryGate()

    const first = await gate.acquireShared(root)
    const second = await gate.acquireShared(child)
    let writerAcquired = false
    const writerPromise = gate.acquireExclusive(root).then((lease) => {
      writerAcquired = true
      return lease
    })

    await Promise.resolve()
    expect(writerAcquired).toBe(false)
    first.release()
    await Promise.resolve()
    expect(writerAcquired).toBe(false)
    second.release()

    const writer = await writerPromise
    expect(writerAcquired).toBe(true)
    writer.release()
    expect(gate.activeLeaseCount()).toBe(0)
  })

  it("prevents later readers from starving an overlapping writer", async () => {
    const root = makeDirectory()
    const gate = new WorkspaceRecoveryGate()
    const firstReader = await gate.acquireShared(root)
    const order: string[] = []
    const writerPromise = gate.acquireExclusive(root).then((lease) => {
      order.push("writer")
      return lease
    })
    const laterReaderPromise = gate.acquireShared(root).then((lease) => {
      order.push("reader")
      return lease
    })

    firstReader.release()
    const writer = await writerPromise
    expect(order).toEqual(["writer"])
    writer.release()
    const laterReader = await laterReaderPromise
    expect(order).toEqual(["writer", "reader"])
    laterReader.release()
  })

  it("queues an exclusive barrier before quiescing existing readers", async () => {
    const root = makeDirectory()
    const gate = new WorkspaceRecoveryGate()
    const existingReader = await gate.acquireShared(root)
    const order: string[] = []

    const writerPromise = gate.acquireExclusiveAfterQuiesce(
      root,
      async () => {
        order.push("quiesce")
        existingReader.release()
      }
    )
    const laterReaderPromise = gate.acquireShared(root).then((lease) => {
      order.push("later-reader")
      return lease
    })

    const writer = await writerPromise
    expect(order).toEqual(["quiesce"])
    writer.release()
    const laterReader = await laterReaderPromise
    expect(order).toEqual(["quiesce", "later-reader"])
    laterReader.release()
  })

  it("cancels the queued exclusive barrier when quiescing fails", async () => {
    const root = makeDirectory()
    const gate = new WorkspaceRecoveryGate()
    const existingReader = await gate.acquireShared(root)

    await expect(
      gate.acquireExclusiveAfterQuiesce(root, async () => {
        throw new Error("could not stop terminal")
      })
    ).rejects.toThrow("could not stop terminal")
    expect(gate.waitingLeaseCount()).toBe(0)

    const laterReader = await gate.acquireShared(root)
    existingReader.release()
    laterReader.release()
    expect(gate.activeLeaseCount()).toBe(0)
  })

  it("fails a non-waiting exclusive acquisition while a reader is active", async () => {
    const root = makeDirectory()
    const gate = new WorkspaceRecoveryGate()
    const reader = await gate.acquireShared(root)

    expect(gate.tryAcquireExclusive(path.join(root, "nested"))).toBeNull()

    reader.release()
    const writer = gate.tryAcquireExclusive(root)
    expect(writer).not.toBeNull()
    writer?.release()
  })

  it("allows unrelated workspaces to progress independently", async () => {
    const firstRoot = makeDirectory()
    const secondRoot = makeDirectory()
    const gate = new WorkspaceRecoveryGate()
    const writer = await gate.acquireExclusive(firstRoot)

    const reader = await gate.acquireShared(secondRoot)
    expect(gate.activeLeaseCount()).toBe(2)

    reader.release()
    writer.release()
  })

  it("treats linked worktrees with the same common Git directory as one scope", async () => {
    const root = makeDirectory()
    const commonGit = path.join(root, "main.git")
    const worktreeAdmin = path.join(commonGit, "worktrees", "child")
    const firstWorktree = path.join(root, "first")
    const secondWorktree = path.join(root, "second")
    fs.mkdirSync(worktreeAdmin, { recursive: true })
    fs.mkdirSync(firstWorktree)
    fs.mkdirSync(secondWorktree)
    fs.writeFileSync(
      path.join(firstWorktree, ".git"),
      `gitdir: ${worktreeAdmin}\n`
    )
    fs.writeFileSync(
      path.join(secondWorktree, ".git"),
      `gitdir: ${worktreeAdmin}\n`
    )
    fs.writeFileSync(path.join(worktreeAdmin, "commondir"), "../..\n")

    const [firstScope] = resolveWorkspaceRecoveryScopes(firstWorktree)
    const [secondScope] = resolveWorkspaceRecoveryScopes(secondWorktree)
    expect(firstScope?.repositoryId).toBe(secondScope?.repositoryId)

    const gate = new WorkspaceRecoveryGate()
    const reader = await gate.acquireShared(firstWorktree)
    expect(gate.tryAcquireExclusive(secondWorktree)).toBeNull()
    reader.release()
  })
})

function makeDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "betterc0de-recovery-gate-")
  )
  temporaryDirectories.push(directory)
  return directory
}
