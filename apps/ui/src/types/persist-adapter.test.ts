/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const requireCjs = createRequire(import.meta.url)
const { createArrayPersistAdapter } = requireCjs(
  "../../../shell/shared/persist-adapter.cjs",
) as {
  createArrayPersistAdapter: (opts: {
    filePath: () => string
    idField?: string
    warnTag?: string
    buildEntry?: (
      input: Record<string, unknown>,
      existing: Record<string, unknown> | null,
      ctx: { now: string; id: string },
    ) => Record<string, unknown>
  }) => {
    list: () => Array<Record<string, unknown>>
    get: (id: string) => Record<string, unknown> | null
    save: (input: Record<string, unknown>) => Record<string, unknown>
    update: (
      id: string,
      patcher:
        | Record<string, unknown>
        | ((entry: Record<string, unknown>) => Record<string, unknown>),
    ) => Record<string, unknown> | null
    remove: (id: string) => boolean
    replaceAll: (items: unknown) => void
  }
}

let tempFile: string

function makeStore(extra: Record<string, unknown> = {}) {
  return createArrayPersistAdapter({
    filePath: () => tempFile,
    warnTag: "persist-adapter-test",
    ...extra,
  } as Parameters<typeof createArrayPersistAdapter>[0])
}

describe("createArrayPersistAdapter", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-adapter-"))
    tempFile = path.join(dir, "items.json")
  })

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(tempFile), { recursive: true, force: true })
    } catch {
      // Best-effort cleanup; failure to delete the temp dir doesn't change test outcome.
    }
  })

  it("returns an empty array when the file does not exist", () => {
    const store = makeStore()
    expect(store.list()).toEqual([])
  })

  it("save() inserts a new entry with generated id and timestamps", () => {
    const store = makeStore()
    const entry = store.save({ name: "alpha" })
    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toBeTruthy()
    expect(entry.updatedAt).toBeTruthy()
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].name).toBe("alpha")
  })

  it("save() preserves a caller-supplied id and updates an existing row", async () => {
    const store = makeStore()
    const created = store.save({ id: "fixed-1", name: "first" })
    // Force a millisecond gap so updatedAt is different.
    await new Promise((r) => setTimeout(r, 5))
    const updated = store.save({ id: "fixed-1", name: "second" })
    expect(updated.id).toBe("fixed-1")
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].name).toBe("second")
    expect(updated.createdAt).toBe(created.createdAt) // preserved
    expect(updated.updatedAt).not.toBe(created.createdAt) // changed
  })

  it("save() runs `buildEntry` when supplied", () => {
    const store = makeStore({
      buildEntry: (
        input: Record<string, unknown>,
        existing: Record<string, unknown> | null,
        { now, id }: { now: string; id: string },
      ) => ({
        id,
        derived: `value:${String(input.input)}`,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }),
    })
    const entry = store.save({ id: "k", input: "raw" })
    expect(entry).toMatchObject({ id: "k", derived: "value:raw" })
  })

  it("update() applies a patch object", () => {
    const store = makeStore()
    store.save({ id: "k", name: "first", flag: false })
    const updated = store.update("k", { flag: true })
    expect(updated).toMatchObject({ name: "first", flag: true })
  })

  it("update() applies a patcher function", () => {
    const store = makeStore()
    store.save({ id: "k", count: 1 })
    const updated = store.update("k", (entry) => ({
      ...entry,
      count: (entry.count as number) + 1,
    }))
    expect(updated?.count).toBe(2)
  })

  it("update() returns null when the id is missing", () => {
    const store = makeStore()
    expect(store.update("missing", { x: 1 })).toBeNull()
  })

  it("remove() deletes the matching row and returns true", () => {
    const store = makeStore()
    store.save({ id: "a" })
    store.save({ id: "b" })
    expect(store.remove("a")).toBe(true)
    expect(store.list().map((x) => x.id)).toEqual(["b"])
  })

  it("remove() returns false when no row matches", () => {
    const store = makeStore()
    store.save({ id: "a" })
    expect(store.remove("missing")).toBe(false)
    expect(store.list()).toHaveLength(1)
  })

  it("get() returns the row by id or null", () => {
    const store = makeStore()
    store.save({ id: "k", name: "x" })
    expect(store.get("k")?.name).toBe("x")
    expect(store.get("missing")).toBeNull()
  })

  it("replaceAll() overwrites the file contents", () => {
    const store = makeStore()
    store.save({ id: "a" })
    store.replaceAll([{ id: "b" }, { id: "c" }])
    expect(store.list().map((x) => x.id)).toEqual(["b", "c"])
  })

  it("replaceAll() rejects non-array input without erasing the collection", () => {
    const store = makeStore()
    store.save({ id: "a" })
    expect(() => store.replaceAll("not an array")).toThrow(/collection/)
    expect(store.list().map((item) => item.id)).toEqual(["a"])
  })

  it("idField option keys persistence by a custom field", () => {
    const store = makeStore({ idField: "slug" })
    store.save({ slug: "alpha" })
    expect(store.get("alpha")).toBeTruthy()
    store.save({ slug: "alpha", note: "second" })
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].note).toBe("second")
  })

  it("survives a corrupted JSON file by treating it as empty", () => {
    fs.writeFileSync(tempFile, "{not valid json")
    const store = makeStore()
    expect(store.list()).toEqual([])
    store.save({ id: "k" })
    expect(store.list()).toHaveLength(1)
  })
})
