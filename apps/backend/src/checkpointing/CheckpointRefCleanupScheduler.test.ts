import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openDatabase, type Db } from "../persistence/db"
import { runMigrations } from "../persistence/migrations"
import { deleteCheckpointRefs } from "../services/git"
import { CheckpointRefCleanupScheduler } from "./CheckpointRefCleanupScheduler"
import { CheckpointRefCleanupStore } from "./CheckpointRefCleanupStore"

vi.mock("../services/git", () => ({
  deleteCheckpointRefs: vi.fn(),
}))

const deleteCheckpointRefsMock = vi.mocked(deleteCheckpointRefs)

describe("CheckpointRefCleanupStore and CheckpointRefCleanupScheduler", () => {
  let dir: string
  let db: Db
  let store: CheckpointRefCleanupStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-ref-cleanup-"))
    db = openDatabase(path.join(dir, "test.sqlite"))
    runMigrations(db)
    store = new CheckpointRefCleanupStore(db)
    deleteCheckpointRefsMock.mockReset()
    deleteCheckpointRefsMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("migration 42 adds generation-safe cleanup intents", () => {
    expect(
      db.prepare(
        "SELECT name FROM schema_migrations WHERE version = 40"
      ).get()
    ).toEqual({ name: "checkpoint_ref_cleanup_queue" })
    expect(
      (
        db.prepare(
          "PRAGMA table_info(checkpoint_ref_cleanup_queue)"
        ).all() as Array<{ name: string }>
      ).map((column) => column.name)
    ).toEqual([
      "cwd",
      "checkpoint_ref",
      "thread_id",
      "attempts",
      "last_error",
      "created_at",
      "updated_at",
      "intent_id",
    ])

    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/a", "refs/checkpoint/a"],
    })
    store.enqueue({
      threadId: "thread-2",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/a", "refs/checkpoint/b"],
    })

    expect(store.list()).toEqual([
      expect.objectContaining({
        cwd: "/repo",
        checkpointRef: "refs/checkpoint/a",
        threadId: "thread-2",
        attempts: 0,
        lastError: null,
      }),
      expect.objectContaining({
        cwd: "/repo",
        checkpointRef: "refs/checkpoint/b",
        threadId: "thread-2",
        attempts: 0,
        lastError: null,
      }),
    ])
  })

  it("does not let a stale worker acknowledge a replacement intent", () => {
    const [first] = store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/reused"],
    })
    const [replacement] = store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/reused"],
    })

    expect(first?.intentId).not.toBe(replacement?.intentId)
    expect(first && store.completeIntent(first)).toBe(false)
    expect(store.get("/repo", "refs/checkpoint/reused")).toMatchObject({
      intentId: replacement?.intentId,
      attempts: 0,
    })
    expect(
      first && store.recordIntentFailure(first, new Error("stale failure"))
    ).toBe(false)
    expect(store.get("/repo", "refs/checkpoint/reused")).toMatchObject({
      intentId: replacement?.intentId,
      attempts: 0,
      lastError: null,
    })
  })

  it("deletes an unreferenced ref and completes its queue entry", async () => {
    store.enqueue({
      threadId: "thread-1",
      cwd: "/stored/repo",
      checkpointRefs: ["refs/checkpoint/stale"],
    })
    const scheduler = new CheckpointRefCleanupScheduler(
      store,
      () => "/resolved/repo"
    )

    await expect(scheduler.recoverOrphansAtStartup()).resolves.toBe(1)

    expect(deleteCheckpointRefsMock).toHaveBeenCalledWith({
      cwd: "/resolved/repo",
      checkpointRefs: ["refs/checkpoint/stale"],
    })
    expect(store.list()).toEqual([])
  })

  it("retains failed cleanup with an incremented attempt count", async () => {
    deleteCheckpointRefsMock.mockRejectedValue(new Error("repository locked"))
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/retry"],
    })
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    await expect(scheduler.recoverOrphansAtStartup()).resolves.toBe(0)
    await expect(scheduler.runNow()).resolves.toBe(0)

    expect(store.list()).toEqual([
      expect.objectContaining({
        checkpointRef: "refs/checkpoint/retry",
        attempts: 2,
        lastError: "repository locked",
      }),
    ])
  })

  it("never deletes a final checkpoint that is still referenced", async () => {
    const checkpointRef = "refs/checkpoint/final"
    db.prepare(`
      INSERT INTO checkpoint_diffs
        (thread_id, turn_id, checkpoint_ref, diff_content, created_at)
      VALUES ('thread-1', 'turn-1', ?, 'diff', ?)
    `).run(checkpointRef, "2026-07-23T00:00:00.000Z")
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: [checkpointRef],
    })
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    await expect(scheduler.runNow()).resolves.toBe(0)

    expect(deleteCheckpointRefsMock).not.toHaveBeenCalled()
    expect(store.list()).toEqual([])
    expect(
      db.prepare(
        "SELECT checkpoint_ref FROM checkpoint_diffs WHERE checkpoint_ref = ?"
      ).get(checkpointRef)
    ).toEqual({ checkpoint_ref: checkpointRef })
  })

  it("retains the pre-first-turn baseline as a durable reference", async () => {
    const checkpointRef = "refs/checkpoint/baseline"
    db.prepare(`
      INSERT INTO projection_threads(
        thread_id,
        project_id,
        status,
        created_at,
        updated_at
      )
      VALUES ('thread-1', 'project-1', 'active', ?, ?)
    `).run(
      "2026-07-23T00:00:00.000Z",
      "2026-07-23T00:00:00.000Z"
    )
    store.retainBaseline({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRef,
    })
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: [checkpointRef],
    })
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    await expect(scheduler.recoverOrphansAtStartup()).resolves.toBe(0)

    expect(deleteCheckpointRefsMock).not.toHaveBeenCalled()
    expect(store.list()).toEqual([])
    expect(store.getBaseline("thread-1")).toMatchObject({
      cwd: "/repo",
      checkpointRef,
    })
  })

  it("protects a fresh unreferenced capture intent during periodic cleanup", async () => {
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/live-capture"],
    })
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    await expect(scheduler.runNow()).resolves.toBe(0)

    expect(deleteCheckpointRefsMock).not.toHaveBeenCalled()
    expect(store.list()).toEqual([
      expect.objectContaining({
        checkpointRef: "refs/checkpoint/live-capture",
        attempts: 0,
      }),
    ])
  })

  it("defers even retryable cleanup while the reactor still owns the ref", async () => {
    const checkpointRef = "refs/checkpoint/active-retry"
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: [checkpointRef],
    })
    store.recordFailure("/repo", checkpointRef, new Error("first delete failed"))
    let active = true
    const scheduler = new CheckpointRefCleanupScheduler(
      store,
      (entry) => entry.cwd,
      undefined,
      { shouldDefer: () => active }
    )

    await expect(scheduler.runNow()).resolves.toBe(0)
    expect(deleteCheckpointRefsMock).not.toHaveBeenCalled()

    active = false
    await expect(scheduler.runNow()).resolves.toBe(1)
    expect(deleteCheckpointRefsMock).toHaveBeenCalledWith({
      cwd: "/repo",
      checkpointRefs: [checkpointRef],
    })
    expect(store.list()).toEqual([])
  })

  it("waits for an active cleanup run before stop resolves", async () => {
    let releaseDelete!: () => void
    deleteCheckpointRefsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseDelete = resolve
        })
    )
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: ["refs/checkpoint/in-flight"],
    })
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    const running = scheduler.recoverOrphansAtStartup()
    await waitForMockCall(deleteCheckpointRefsMock, 1)
    let stopSettled = false
    const stopping = scheduler.stop().then(() => {
      stopSettled = true
    })
    await Promise.resolve()
    expect(stopSettled).toBe(false)

    releaseDelete()
    await expect(running).resolves.toBe(1)
    await expect(stopping).resolves.toBeUndefined()
    expect(stopSettled).toBe(true)
    expect(store.list()).toEqual([])
    await expect(scheduler.runNow()).resolves.toBe(0)
  })

  it("keyset-paginates every startup orphan beyond one batch", async () => {
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: Array.from(
        { length: 300 },
        (_, index) => `refs/checkpoint/orphan-${String(index).padStart(3, "0")}`
      ),
    })
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    await expect(scheduler.recoverOrphansAtStartup()).resolves.toBe(300)
    expect(deleteCheckpointRefsMock).toHaveBeenCalledTimes(300)
    expect(store.list(512)).toEqual([])
  })

  it("does not starve a retry behind fresh capture intents", async () => {
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: Array.from(
        { length: 160 },
        (_, index) => `refs/checkpoint/fresh-${String(index).padStart(3, "0")}`
      ),
    })
    const retryRef = "refs/checkpoint/retry-behind-fresh"
    store.enqueue({
      threadId: "thread-1",
      cwd: "/repo",
      checkpointRefs: [retryRef],
    })
    store.recordFailure("/repo", retryRef, new Error("transient"))
    const scheduler = new CheckpointRefCleanupScheduler(store, (entry) =>
      entry.cwd
    )

    await expect(scheduler.runNow()).resolves.toBe(1)
    expect(deleteCheckpointRefsMock).toHaveBeenCalledTimes(1)
    expect(deleteCheckpointRefsMock).toHaveBeenCalledWith({
      cwd: "/repo",
      checkpointRefs: [retryRef],
    })
    expect(store.get("/repo", retryRef)).toBeNull()
    expect(store.list(512)).toHaveLength(160)
  })
})

async function waitForMockCall(
  mock: { mock: { calls: unknown[] } },
  count: number
): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (mock.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for mock call ${count}.`)
}
