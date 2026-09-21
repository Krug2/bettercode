import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  ToolOutputArchiveStore,
  type ToolOutputArchiveStoreOptions,
} from "./tool-output-archive-store"

const stores: ToolOutputArchiveStore[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.allSettled(stores.splice(0).map((store) => store.stop()))
  await Promise.allSettled(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

async function createStore(
  options: Omit<ToolOutputArchiveStoreOptions, "directory"> = {}
): Promise<{
  store: ToolOutputArchiveStore
  root: string
  directory: string
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "betterc0de-tool-output-")
  )
  temporaryDirectories.push(root)
  const directory = path.join(root, "archives")
  const store = new ToolOutputArchiveStore({
    directory,
    cleanupIntervalMs: 0,
    ...options,
  })
  stores.push(store)
  await store.start()
  return { store, root, directory }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

describe("ToolOutputArchiveStore", () => {
  it("returns opaque IDs and only opens an archive for its owner", async () => {
    const { store, root } = await createStore()
    const reservation = await store.reserve("remote:owner-a")
    await fs.writeFile(reservation.filePath, "complete retained output", {
      flag: "wx",
      mode: 0o600,
    })

    const committed = await store.commit(reservation)

    expect(committed.id).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(committed.id).not.toContain(path.basename(root))
    await expect(
      store.openForRead(committed.id, "remote:owner-b")
    ).resolves.toBeNull()

    const opened = await store.openForRead(
      committed.id,
      "remote:owner-a"
    )
    expect(opened).not.toBeNull()
    expect(opened?.size).toBe(Buffer.byteLength("complete retained output"))
    await expect(readStream(opened!.stream)).resolves.toBe(
      "complete retained output"
    )
  })

  it("removes oversized and symlinked output instead of committing it", async () => {
    const { store, root } = await createStore({
      maxArchiveBytes: 8,
      maxBytesPerOwner: 16,
      maxTotalBytes: 32,
    })
    const oversized = await store.reserve("local-owner")
    await fs.writeFile(oversized.filePath, "123456789", {
      flag: "wx",
      mode: 0o600,
    })

    await expect(store.commit(oversized)).rejects.toMatchObject({
      code: "TOOL_OUTPUT_ARCHIVE_INVALID",
    })
    await expect(fs.lstat(oversized.filePath)).rejects.toMatchObject({
      code: "ENOENT",
    })

    const outsidePath = path.join(root, "outside.txt")
    await fs.writeFile(outsidePath, "must remain untouched")
    const symlinked = await store.reserve("local-owner")
    try {
      await fs.symlink(outsidePath, symlinked.filePath, "file")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }

    await expect(store.commit(symlinked)).rejects.toMatchObject({
      code: "TOOL_OUTPUT_ARCHIVE_INVALID",
    })
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe(
      "must remain untouched"
    )
    await expect(fs.lstat(symlinked.filePath)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("refuses to use a symlinked archive directory", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "betterc0de-tool-output-directory-")
    )
    temporaryDirectories.push(root)
    const outside = path.join(root, "outside")
    const directory = path.join(root, "archives")
    await fs.mkdir(outside)
    try {
      await fs.symlink(
        outside,
        directory,
        process.platform === "win32" ? "junction" : "dir"
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }
    const store = new ToolOutputArchiveStore({
      directory,
      cleanupIntervalMs: 0,
    })
    stores.push(store)

    await expect(store.start()).rejects.toMatchObject({
      code: "TOOL_OUTPUT_ARCHIVE_DIRECTORY",
    })
    await expect(fs.readdir(outside)).resolves.toEqual([])
  })

  it("reserves worst-case capacity and evicts older owner data first", async () => {
    const { store } = await createStore({
      maxFiles: 2,
      maxFilesPerOwner: 1,
      maxArchiveBytes: 8,
      maxBytesPerOwner: 8,
      maxTotalBytes: 16,
    })
    const first = await store.reserve("local-owner")
    await fs.writeFile(first.filePath, "first", { flag: "wx" })
    const committedFirst = await store.commit(first)

    const second = await store.reserve("local-owner")

    await expect(
      store.openForRead(committedFirst.id, "local-owner")
    ).resolves.toBeNull()
    await store.discard(second)
  })

  it("cleans orphaned pending files at startup and expired archives later", async () => {
    let now = 1_000
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "betterc0de-tool-output-startup-")
    )
    temporaryDirectories.push(root)
    const directory = path.join(root, "archives")
    await fs.mkdir(directory, { recursive: true })
    const orphanId = "A".repeat(32)
    await fs.writeFile(path.join(directory, `${orphanId}.txt`), "partial")
    await fs.writeFile(
      path.join(directory, `${orphanId}.pending.json`),
      JSON.stringify({
        version: 1,
        id: orphanId,
        ownerId: "local-owner",
        createdAt: now,
      })
    )

    const store = new ToolOutputArchiveStore({
      directory,
      cleanupIntervalMs: 0,
      retentionMs: 10,
      now: () => now,
    })
    stores.push(store)
    await store.start()
    await expect(fs.readdir(directory)).resolves.toEqual([])

    const reservation = await store.reserve("local-owner")
    await fs.writeFile(reservation.filePath, "retained", { flag: "wx" })
    const committed = await store.commit(reservation)
    now += 11
    await store.cleanup()

    await expect(
      store.openForRead(committed.id, "local-owner")
    ).resolves.toBeNull()
  })
})
