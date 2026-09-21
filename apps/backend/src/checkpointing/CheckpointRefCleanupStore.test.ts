import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDatabase, type Db } from "../persistence/db"
import { runMigrations } from "../persistence/migrations"
import { CheckpointRefCleanupStore } from "./CheckpointRefCleanupStore"

describe("CheckpointRefCleanupStore", () => {
  let dir: string
  let db: Db
  let store: CheckpointRefCleanupStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-ref-store-"))
    db = openDatabase(path.join(dir, "test.sqlite"))
    runMigrations(db)
    store = new CheckpointRefCleanupStore(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("completes a batch of refs in one statement set and ignores unknown refs", () => {
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/a", "refs/b", "refs/c"],
    })
    store.enqueue({
      threadId: "thread-2",
      cwd: "/other",
      checkpointRefs: ["refs/a"],
    })

    store.complete("/repo", ["refs/a", "refs/b", "refs/missing", "refs/a"])

    expect(
      store
        .list()
        .map((entry) => `${entry.cwd} ${entry.checkpointRef}`)
        .sort()
    ).toEqual(["/other refs/a", "/repo refs/c"])
  })

  it("complete acknowledges whatever the current generation is", () => {
    const [first] = store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/a"],
    })
    const [replacement] = store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/a"],
    })
    expect(replacement.intentId).not.toBe(first.intentId)

    // A worker holding the stale intent cannot acknowledge the replacement…
    expect(store.completeIntent(first)).toBe(false)
    expect(store.get("/repo", "refs/a")?.intentId).toBe(replacement.intentId)
    // …while the generation-agnostic helper acknowledges the live one.
    store.complete("/repo", ["refs/a"])
    expect(store.get("/repo", "refs/a")).toBeNull()
  })

  it("serves both listBatch eligibility shapes from prepared statements", () => {
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/fresh"],
    })
    store.recordFailure("/repo", "refs/fresh", new Error("transient"))
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/untouched"],
    })
    const createdBefore = "2999-01-01T00:00:00.000Z"

    expect(
      store
        .listBatch({ includeFresh: true, createdBefore })
        .map((entry) => entry.checkpointRef)
        .sort()
    ).toEqual(["refs/fresh", "refs/untouched"])
    expect(
      store
        .listBatch({ includeFresh: false, createdBefore })
        .map((entry) => entry.checkpointRef)
    ).toEqual(["refs/fresh"])
  })
})
