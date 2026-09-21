import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readStagedPng } from "./image-generation"

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])
const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  )
})

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "betterc0de-png-"))
  directories.push(directory)
  return directory
}

describe("readStagedPng", () => {
  it("accepts a bounded regular file with the PNG signature", async () => {
    const directory = await temporaryDirectory()
    const file = path.join(directory, "asset.png")
    await fs.writeFile(file, PNG)

    await expect(readStagedPng(file)).resolves.toEqual(PNG)
  })

  it("rejects non-PNG content", async () => {
    const directory = await temporaryDirectory()
    const file = path.join(directory, "asset.png")
    await fs.writeFile(file, "not a png")

    await expect(readStagedPng(file)).rejects.toThrow(/valid PNG/i)
  })

  it("does not follow a staged source symlink", async () => {
    const directory = await temporaryDirectory()
    const target = path.join(directory, "outside.png")
    const link = path.join(directory, "asset.png")
    await fs.writeFile(target, PNG)
    try {
      await fs.symlink(target, link, "file")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }

    await expect(readStagedPng(link)).resolves.toBeNull()
  })
})
