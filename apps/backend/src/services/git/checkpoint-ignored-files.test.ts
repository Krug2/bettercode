import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { checkpointRefForThreadTurn } from "@betterc0de/schema"
import {
  captureCheckpoint,
  restoreCheckpoint,
  undoCheckpointRestore,
} from "./checkpoints"

const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true })
})
function repository() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bc-checkpoint-ignored-"))
  directories.push(cwd)
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true })
  const write = (file: string, content: string) =>
    fs.writeFileSync(path.join(cwd, file), content)
  const read = (file: string) => fs.readFileSync(path.join(cwd, file), "utf8")
  git("init")
  git("config", "user.name", "Test")
  git("config", "user.email", "test@localhost")
  write(".gitignore", "")
  write("main.txt", "base")
  git("add", ".")
  git("commit", "-m", "base")
  return { cwd, git, write, read }
}

it("preserves excluded data when restore changes ignore rules and still removes snapshotted additions", async () => {
  const { cwd, write, read } = repository()
  const ref = checkpointRefForThreadTurn("ignored-data", 1)
  await captureCheckpoint({ cwd, checkpointRef: ref })
  write(".gitignore", "local.txt\n")
  write("local.txt", "irreplaceable data")
  write("addition.txt", "new tracked-in-snapshot file")
  const restored = await restoreCheckpoint({ cwd, checkpointRef: ref })
  expect(restored.restored).toBe(true)
  expect(read("local.txt")).toBe("irreplaceable data")
  expect(fs.existsSync(path.join(cwd, "addition.txt"))).toBe(false)
  expect(
    await undoCheckpointRestore({ cwd, safetyRef: restored.safetyRef! })
  ).toBe(true)
  expect(read("local.txt")).toBe("irreplaceable data")
  expect(read("addition.txt")).toBe("new tracked-in-snapshot file")
})

it("preserves ignored data when Undo changes ignore rules", async () => {
  const { cwd, write, read } = repository()
  const ref = checkpointRefForThreadTurn("ignored-undo", 1)
  write(".gitignore", "local.txt\n")
  await captureCheckpoint({ cwd, checkpointRef: ref })
  write(".gitignore", "")
  const restored = await restoreCheckpoint({ cwd, checkpointRef: ref })
  write("local.txt", "created after restore")
  await undoCheckpointRestore({ cwd, safetyRef: restored.safetyRef! })
  expect(read("local.txt")).toBe("created after restore")
})

it.each(["file", "directory", "parent-file"])(
  "refuses an ignored %s collision before changing any worktree bytes",
  async (kind) => {
    const { cwd, write, read } = repository()
    const ref = checkpointRefForThreadTurn("ignored-collision", 1)
    if (kind === "parent-file") {
      fs.mkdirSync(path.join(cwd, "local"))
      write("local/target.txt", "checkpoint")
    } else {
      write("local", "checkpoint")
    }
    await captureCheckpoint({ cwd, checkpointRef: ref })
    fs.rmSync(path.join(cwd, "local"), { recursive: true })
    write(".gitignore", "local\n")
    if (kind === "directory") {
      fs.mkdirSync(path.join(cwd, "local"))
      write("local/private.txt", "private")
    } else {
      write("local", "private")
    }
    write("main.txt", "keep current edits")
    await expect(
      restoreCheckpoint({ cwd, checkpointRef: ref })
    ).rejects.toMatchObject({ code: "checkpoint_restore_unprotected_path" })
    expect(read("main.txt")).toBe("keep current edits")
    expect(read(".gitignore")).toBe("local\n")
    expect(read(kind === "directory" ? "local/private.txt" : "local")).toBe(
      "private"
    )
  }
)

it("refuses an ignored collision during Undo", async () => {
  const { cwd, write, read } = repository()
  const ref = checkpointRefForThreadTurn("undo-collision", 1)
  write(".gitignore", "local.txt\n")
  await captureCheckpoint({ cwd, checkpointRef: ref })
  write(".gitignore", "")
  write("local.txt", "pre-restore version")
  const restored = await restoreCheckpoint({ cwd, checkpointRef: ref })
  write("local.txt", "new ignored data")
  await expect(
    undoCheckpointRestore({ cwd, safetyRef: restored.safetyRef! })
  ).rejects.toMatchObject({ code: "checkpoint_restore_unprotected_path" })
  expect(read("local.txt")).toBe("new ignored data")
})

it("fails without mutation for legacy safety refs without a recorded restore target", async () => {
  const { cwd, git, write, read } = repository()
  const legacy = "refs/betterc0de/pre-restore/legacy"
  git("update-ref", legacy, "HEAD") // The initial commit has no parent.
  write("main.txt", "keep current edits")
  write("new.txt", "keep untracked data")
  await expect(
    undoCheckpointRestore({ cwd, safetyRef: legacy })
  ).rejects.toMatchObject({ code: "checkpoint_restore_manifest_missing" })
  expect(read("main.txt")).toBe("keep current edits")
  expect(read("new.txt")).toBe("keep untracked data")
})
