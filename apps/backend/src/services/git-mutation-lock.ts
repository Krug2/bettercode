import path from "node:path"
import fs from "node:fs/promises"
import { gitRun } from "./git/process"

/**
 * Per-repository exclusive lock for mutating Git routes.
 *
 * Git serialises index writes with `.git/index.lock`; two concurrent
 * mutations on the same checkout (a commit racing a stage, two pushes) do
 * not queue — the second fails with "index.lock exists" and the user sees a
 * spurious error. The checkpoint-recovery fence around these routes is a
 * *shared* lease by design (it only excludes recovery), so it never
 * serialised them. This keyed promise chain does. Reads stay unlocked.
 *
 * Keyed by the checkout's canonical Git directory, so subdirectories and
 * aliases share a lock. Linked worktrees have separate Git directories/indexes.
 */
export class KeyedAsyncLock {
  private readonly tails = new Map<string, Promise<void>>()

  /** Number of keys with an active or queued holder — for tests. */
  size(): number {
    return this.tails.size
  }

  async withLock<T>(key: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release = (): void => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

export const gitMutationLock = new KeyedAsyncLock()

export async function gitMutationLockKey(cwd: string): Promise<string> {
  const root = await fs.realpath(cwd)
  let gitDirectory: string
  try {
    const { stdout } = await gitRun(root, ["rev-parse", "--absolute-git-dir"], {
      env: { LC_ALL: "C" },
    })
    gitDirectory = await fs.realpath(stdout.trim())
  } catch (error) {
    // `git init` needs a stable key both before and after .git is created.
    // Never turn a process failure, timeout, or inaccessible repo into a new lock.
    const failure = error as { exitCode?: unknown; stderr?: unknown }
    if (
      failure.exitCode !== 128 ||
      typeof failure.stderr !== "string" ||
      !/not a git repository/i.test(failure.stderr)
    )
      throw error
    gitDirectory = path.join(root, ".git")
  }
  const normalized = path.normalize(gitDirectory)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

export async function withGitMutationLock<T>(
  cwd: string,
  operation: () => Promise<T> | T
): Promise<T> {
  return gitMutationLock.withLock(await gitMutationLockKey(cwd), operation)
}
