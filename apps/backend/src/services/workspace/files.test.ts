import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { writeFile } from "./files"

describe("workspace atomic write cleanup", () => {
  let directory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "bc0de-file-write-"))
    await fs.writeFile(path.join(directory, "original.txt"), "original")
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it.each(["writeFile", "sync"] as const)("removes its temporary file when %s fails", async (method) => {
    const open = fs.open.bind(fs)
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await open(...args)
      vi.spyOn(handle, method).mockRejectedValueOnce(new Error("disk write failed"))
      return handle
    })

    await expect(writeFile(directory, "original.txt", "replacement")).rejects.toThrow("disk write failed")
    expect(await fs.readFile(path.join(directory, "original.txt"), "utf8")).toBe("original")
    expect(await fs.readdir(directory)).toEqual(["original.txt"])
  })
})
