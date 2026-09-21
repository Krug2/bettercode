import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { checkpointRefForThreadTurn } from "@betterc0de/schema"
import { openDatabase, type Db } from "../persistence/db"
import { runMigrations } from "../persistence/migrations"
import { CheckpointReactor } from "./CheckpointReactor"
import { CheckpointTurnSlotStore } from "./CheckpointTurnSlotStore"

describe("CheckpointTurnSlotStore", () => {
  let dir: string
  let db: Db

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-turn-slots-"))
    db = openDatabase(path.join(dir, "test.sqlite"))
    runMigrations(db)
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
  })

  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("continues native checkpoint slots across store instances", () => {
    const firstProcess = new CheckpointTurnSlotStore(db)
    expect(firstProcess.allocate("thread-1")).toEqual({
      slot: 0,
      turnCount: 1,
    })

    const restartedProcess = new CheckpointTurnSlotStore(db)
    expect(restartedProcess.allocate("thread-1")).toEqual({
      slot: 1,
      turnCount: 2,
    })
  })

  it("prevents two reactor processes from reusing native checkpoint refs", async () => {
    const capturedRefs: string[] = []
    const createReactor = (slots: CheckpointTurnSlotStore) =>
      new CheckpointReactor({
        eventBus: new EventEmitter(),
        threads: { getThreadProjectPath: () => "/repo" },
        logger: { warn: () => {}, error: () => {} },
        captureCheckpoint: async ({ checkpointRef }) => {
          capturedRefs.push(checkpointRef)
        },
        deleteCheckpointRefs: async () => {},
        diffCheckpoints: async () => ({ diff: "" }),
        isGitRepo: async () => true,
        allocateTurnSlot: (threadId, explicitTurnIndex) =>
          slots.allocate(threadId, explicitTurnIndex),
        reconcileTurnSlot: (threadId) => slots.reconcileThread(threadId),
        emitEvent: () => {},
      })

    const firstReactor = createReactor(new CheckpointTurnSlotStore(db))
    await firstReactor.ingest({
      event_type: "turn_started",
      thread_id: "thread-1",
      payload: { turn_id: "native-before-restart" },
    })
    await firstReactor.ingest({
      event_type: "turn_completed",
      thread_id: "thread-1",
      payload: { turn_id: "native-before-restart" },
    })
    db.prepare(`
      INSERT INTO turn_diffs(
        thread_id,
        turn_index,
        diff_text,
        created_at
      )
      VALUES ('thread-1', 1, '', ?)
    `).run("2026-07-23T00:00:01.000Z")

    const restartedSlots = new CheckpointTurnSlotStore(db)
    restartedSlots.reconcileAll()
    const restartedReactor = createReactor(restartedSlots)
    await restartedReactor.ingest({
      event_type: "turn_started",
      thread_id: "thread-1",
      payload: { turn_id: "native-after-restart" },
    })
    await restartedReactor.ingest({
      event_type: "turn_completed",
      thread_id: "thread-1",
      payload: { turn_id: "native-after-restart" },
    })

    expect(capturedRefs).toEqual([
      checkpointRefForThreadTurn("thread-1", 0),
      checkpointRefForThreadTurn("thread-1", 1),
      checkpointRefForThreadTurn("thread-1", 2),
      checkpointRefForThreadTurn("thread-1", 3),
    ])
  })

  it("advances the durable boundary for an explicit turn index", () => {
    const store = new CheckpointTurnSlotStore(db)

    expect(store.allocate("thread-1", 7)).toEqual({
      slot: 6,
      turnCount: 7,
    })
    expect(store.allocate("thread-1")).toEqual({
      slot: 7,
      turnCount: 8,
    })
    expect(store.allocate("thread-1", 2)).toEqual({
      slot: 8,
      turnCount: 9,
    })
  })

  it("rejects oversized provider ordinals before advancing the allocator", () => {
    const store = new CheckpointTurnSlotStore(db)
    expect(() => store.allocate("thread-1", Number.MAX_SAFE_INTEGER)).toThrow("safe integer range")
    expect(store.allocate("thread-1")).toEqual({ slot: 0, turnCount: 1 })
  })

  it("repairs a slot reserved immediately before a process crash", () => {
    const crashedProcess = new CheckpointTurnSlotStore(db)
    expect(crashedProcess.allocate("thread-1").slot).toBe(0)

    const restartedProcess = new CheckpointTurnSlotStore(db)
    restartedProcess.reconcileAll()

    expect(restartedProcess.allocate("thread-1")).toEqual({
      slot: 0,
      turnCount: 1,
    })
  })

  it("preserves an admitted crash-gap until its exact diff is projected", () => {
    const store = new CheckpointTurnSlotStore(db)
    const allocation = store.allocate("thread-1")
    const baseCheckpointRef = checkpointRefForThreadTurn("thread-1", 0)
    const checkpointRef = checkpointRefForThreadTurn("thread-1", 1)
    store.recordAdmission({
      threadId: "thread-1",
      turnKey: "turn:dispatch-crashed",
      turnId: "native-crashed",
      dispatchTurnId: "dispatch-crashed",
      turnCount: allocation.turnCount,
      cwd: "/repo",
      baseCheckpointRef,
      checkpointRef,
    })

    const restarted = new CheckpointTurnSlotStore(db)
    restarted.reconcileAll()

    expect(restarted.allocate("thread-1")).toEqual({
      slot: 1,
      turnCount: 2,
    })
    expect(() => restarted.reconcileThread("thread-1")).toThrow(
      /unresolved/,
    )
    expect(restarted.isAdmissionRefPending(baseCheckpointRef)).toBe(true)

    db.prepare(`
      INSERT INTO turn_diffs(
        thread_id,
        turn_index,
        turn_id,
        dispatch_turn_id,
        diff_text,
        created_at
      )
      VALUES ('thread-1', 1, 'native-crashed', 'dispatch-crashed', '', ?)
    `).run("2026-07-23T00:00:01.000Z")
    db.prepare(`
      INSERT INTO checkpoint_diffs(
        thread_id,
        turn_id,
        checkpoint_ref,
        diff_content,
        created_at
      )
      VALUES ('thread-1', 'dispatch-crashed', ?, '', ?)
    `).run(checkpointRef, "2026-07-23T00:00:01.000Z")
    restarted.completeAdmission({
      threadId: "thread-1",
      turnKey: "turn:dispatch-crashed",
      turnCount: 1,
      checkpointRef,
    })

    expect(restarted.listAdmissions()).toEqual([])
    expect(restarted.isAdmissionRefPending(checkpointRef)).toBe(false)
  })

  it("retains the primary failure suffix when bounding verbose Git errors", () => {
    const store = new CheckpointTurnSlotStore(db)
    const allocation = store.allocate("thread-1")
    store.recordAdmission({
      threadId: "thread-1",
      turnKey: "turn:verbose-failure",
      turnId: "native-verbose-failure",
      dispatchTurnId: "dispatch-verbose-failure",
      turnCount: allocation.turnCount,
      cwd: "/repo",
      baseCheckpointRef: checkpointRefForThreadTurn("thread-1", 0),
      checkpointRef: checkpointRefForThreadTurn("thread-1", 1),
    })

    const terminalReason =
      "git add was stopped during backend startup shutdown"
    store.markAdmissionFailed(
      "thread-1",
      "turn:verbose-failure",
      new Error(`${"warning: line ending conversion\n".repeat(1_000)}${terminalReason}`)
    )

    const admission = store.getAdmission(
      "thread-1",
      "turn:verbose-failure"
    )
    expect(admission?.status).toBe("failed")
    expect(admission?.lastError).toHaveLength(16_384)
    expect(admission?.lastError).toContain(
      "checkpoint admission error truncated"
    )
    expect(admission?.lastError).toContain(terminalReason)
  })

  it("rewinds allocation to the projected boundary after a revert", () => {
    const insertDiff = db.prepare(`
      INSERT INTO turn_diffs(
        thread_id,
        turn_index,
        diff_text,
        created_at
      )
      VALUES ('thread-1', ?, '', ?)
    `)
    insertDiff.run(1, "2026-07-23T00:00:01.000Z")
    insertDiff.run(2, "2026-07-23T00:00:02.000Z")
    const store = new CheckpointTurnSlotStore(db)
    store.reconcileAll()
    expect(store.allocate("thread-1").slot).toBe(2)

    db.prepare(`
      DELETE FROM turn_diffs
      WHERE thread_id = 'thread-1' AND turn_index > 1
    `).run()
    expect(store.reconcileThread("thread-1")).toBe(1)
    expect(store.allocate("thread-1")).toEqual({
      slot: 1,
      turnCount: 2,
    })
  })
})
