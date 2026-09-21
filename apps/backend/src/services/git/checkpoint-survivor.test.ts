import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { checkpointRefForThreadTurn } from "@betterc0de/schema"
import { restoreCheckpoint } from "./checkpoints"
import { gitRun } from "./process"

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  gitRun: vi.fn(),
}))

const directories: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

it("retains the preview index and stops restore when its Git process survives", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bc-checkpoint-survivor-"))
  directories.push(cwd)
  const survivor = Object.assign(new Error("unconfirmed Git process tree"), {
    survivor: true,
  })
  let previewIndex = ""
  let survived = false
  const callsAfterSurvivor: string[][] = []
  vi.mocked(gitRun).mockImplementation(async (_cwd, args, options) => {
    if (survived) callsAfterSurvivor.push(args)
    if (args[0] === "rev-parse") {
      if (args.includes("--git-common-dir")) return { stdout: cwd, stderr: "" }
      if (args.includes("--is-bare-repository"))
        return { stdout: "false\nmissing-index\n", stderr: "" }
      return { stdout: "a".repeat(40), stderr: "" }
    }
    if (args[0] === "read-tree") {
      previewIndex = options!.env!.GIT_INDEX_FILE!
      fs.writeFileSync(previewIndex, "live index")
      fs.writeFileSync(`${previewIndex}.lock`, "live lock")
    }
    if (args[0] === "add") {
      survived = true
      throw survivor
    }
    return { stdout: "", stderr: "" }
  })

  await expect(
    restoreCheckpoint({
      cwd,
      checkpointRef: checkpointRefForThreadTurn("survivor", 1),
    })
  ).rejects.toBe(survivor)
  expect(fs.readFileSync(previewIndex, "utf8")).toBe("live index")
  expect(fs.readFileSync(`${previewIndex}.lock`, "utf8")).toBe("live lock")
  expect(callsAfterSurvivor).toEqual([])
})
