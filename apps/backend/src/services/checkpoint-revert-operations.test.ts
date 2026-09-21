import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { openDatabase, type Db } from "../persistence/db"
import { runMigrations } from "../persistence/migrations"
import {
  assertCheckpointRevertTurnRange,
  CheckpointRevertOperationStore,
  MAX_CHECKPOINT_REVERT_TURN_RANGE,
} from "./checkpoint-revert-operations"

const tempDirs: string[] = []
let db: Db | null = null

afterEach(() => {
  db?.close()
  db = null
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("CheckpointRevertOperationStore", () => {
  it("bounds expansion while allowing a small revert in a large safe history", () => {
    expect(() => assertCheckpointRevertTurnRange(0, MAX_CHECKPOINT_REVERT_TURN_RANGE)).not.toThrow()
    expect(() => assertCheckpointRevertTurnRange(0, MAX_CHECKPOINT_REVERT_TURN_RANGE + 1)).toThrow()
    const largestPairedTurn = Math.ceil(Number.MAX_SAFE_INTEGER / 2)
    expect(() => assertCheckpointRevertTurnRange(largestPairedTurn - 1, largestPairedTurn)).not.toThrow()
    expect(() => assertCheckpointRevertTurnRange(largestPairedTurn, largestPairedTurn + 1)).toThrow()
    expect(() => assertCheckpointRevertTurnRange(0, Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })

  it("persists phase transitions until cleanup completes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-revert-"))
    tempDirs.push(dir)
    db = openDatabase(path.join(dir, "state.db"))
    runMigrations(db)
    db.prepare(
      `
      INSERT INTO projection_threads
        (thread_id, project_id, title, status, env_mode, created_at, updated_at,
         message_count, turn_count)
      VALUES (?, 'project', 'Thread', 'active', 'local', ?, ?, 0, 0)
    `
    ).run("thread-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    const store = new CheckpointRevertOperationStore(db)

    const operation = store.begin({
      threadId: "thread-1",
      turnCount: 1,
      currentTurnCount: 2,
      updatedAt: "2026-01-01T00:01:00.000Z",
      cwd: "/repo",
      providerKind: "claude",
      providerInstanceId: "claude-main",
      targetCheckpointRef: "refs/checkpoints/1",
      currentCheckpointRef: "refs/checkpoints/3",
      staleCheckpointRefs: ["refs/checkpoints/3"],
      preserveFuture: false,
    })
    store.setPhase(operation, "provider_rollback_started")

    expect(store.list()).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        phase: "provider_rollback_started",
        staleCheckpointRefs: ["refs/checkpoints/3"],
      }),
    ])
    expect(store.hasBlockingRecovery("thread-1")).toBe(true)
    expect(store.blockingThreadForCwd(path.join("/repo", "."))).toBe("thread-1")
    expect(
      store.blockingThreadForCwd(path.join("/repo", "nested", "directory"))
    ).toBe("thread-1")
    expect(store.blockingThreadForCwd(path.resolve("/repo", ".."))).toBe(
      "thread-1"
    )
    expect(store.blockingThreadForCwd(path.dirname("/repo"))).toBe("thread-1")

    store.delete("thread-1")
    expect(store.list()).toEqual([])
    expect(store.hasBlockingRecovery("thread-1")).toBe(false)

    store.begin({ ...operation, currentTurnCount: 2 })
    const { payload_json: payload } = db.prepare(
      "SELECT payload_json FROM checkpoint_revert_operations WHERE thread_id = ?"
    ).get("thread-1") as { payload_json: string }
    db.prepare("UPDATE checkpoint_revert_operations SET payload_json = ? WHERE thread_id = ?").run(
      JSON.stringify({ ...JSON.parse(payload), currentTurnCount: MAX_CHECKPOINT_REVERT_TURN_RANGE + 2 }),
      "thread-1"
    )
    expect(store.list()).toEqual([])
    expect(store.hasRecoveryRequired("thread-1")).toBe(true)
    expect(store.listQuarantined("thread-1")).toHaveLength(1)
  })

  it("skips malformed rows without hiding valid recovery operations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-revert-"))
    tempDirs.push(dir)
    db = openDatabase(path.join(dir, "state.db"))
    runMigrations(db)
    const createdAt = "2026-01-01T00:00:00.000Z"
    const insertThread = db.prepare(`
      INSERT INTO projection_threads
        (thread_id, project_id, title, status, env_mode, created_at, updated_at,
         message_count, turn_count)
      VALUES (?, 'project', 'Thread', 'active', 'local', ?, ?, 0, 0)
    `)
    insertThread.run("thread-broken", createdAt, createdAt)
    insertThread.run("thread-valid", createdAt, createdAt)
    db.prepare(
      `
      INSERT INTO checkpoint_revert_operations
        (thread_id, phase, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run("thread-broken", "prepared", "{not-json", createdAt, createdAt)
    const store = new CheckpointRevertOperationStore(db)
    store.begin({
      threadId: "thread-valid",
      turnCount: 1,
      currentTurnCount: 2,
      updatedAt: "2026-01-01T00:01:00.000Z",
      cwd: "/repo",
      providerKind: "claude",
      providerInstanceId: "claude-main",
      targetCheckpointRef: "refs/checkpoints/1",
      currentCheckpointRef: "refs/checkpoints/2",
      staleCheckpointRefs: ["refs/checkpoints/2"],
      preserveFuture: false,
    })

    expect(store.list()).toEqual([
      expect.objectContaining({
        threadId: "thread-valid",
        phase: "prepared",
      }),
    ])
    expect(store.hasRecoveryRequired("thread-broken")).toBe(true)
    expect(store.listQuarantined("thread-broken")).toEqual([
      expect.objectContaining({
        threadId: "thread-broken",
        phase: "prepared",
        payloadJson: "{not-json",
      }),
    ])
    expect(store.get("thread-broken")).toBeNull()
    expect(store.hasBlockingRecovery("thread-broken")).toBe(true)
    expect(() =>
      store.begin({
        threadId: "thread-broken",
        turnCount: 0,
        currentTurnCount: 1,
        updatedAt: "2026-01-01T00:01:00.000Z",
        cwd: "/repo",
        providerKind: "claude",
        providerInstanceId: "claude-main",
        targetCheckpointRef: "refs/checkpoints/0",
        currentCheckpointRef: "refs/checkpoints/1",
        staleCheckpointRefs: ["refs/checkpoints/1"],
        preserveFuture: false,
      })
    ).toThrowError(
      expect.objectContaining({ code: "checkpoint_recovery_required" })
    )

    store.resolveQuarantine("thread-broken")
    expect(store.hasRecoveryRequired("thread-broken")).toBe(false)
    expect(store.listQuarantined("thread-broken")).toEqual([])
  })

  it("fences sibling worktrees that share a Git common directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-revert-"))
    tempDirs.push(dir)
    const commonGit = path.join(dir, "main.git")
    const firstAdmin = path.join(commonGit, "worktrees", "first")
    const secondAdmin = path.join(commonGit, "worktrees", "second")
    const firstWorktree = path.join(dir, "first-worktree")
    const secondWorktree = path.join(dir, "second-worktree")
    fs.mkdirSync(firstAdmin, { recursive: true })
    fs.mkdirSync(secondAdmin, { recursive: true })
    fs.mkdirSync(firstWorktree)
    fs.mkdirSync(secondWorktree)
    fs.writeFileSync(
      path.join(firstWorktree, ".git"),
      `gitdir: ${firstAdmin}\n`
    )
    fs.writeFileSync(
      path.join(secondWorktree, ".git"),
      `gitdir: ${secondAdmin}\n`
    )
    fs.writeFileSync(path.join(firstAdmin, "commondir"), "../..\n")
    fs.writeFileSync(path.join(secondAdmin, "commondir"), "../..\n")

    db = openDatabase(path.join(dir, "state.db"))
    runMigrations(db)
    const createdAt = "2026-01-01T00:00:00.000Z"
    db.prepare(
      `
      INSERT INTO projection_threads
        (thread_id, project_id, title, status, env_mode, created_at, updated_at,
         message_count, turn_count)
      VALUES (?, 'project', 'Thread', 'active', 'local', ?, ?, 0, 0)
    `
    ).run("thread-worktree", createdAt, createdAt)
    const store = new CheckpointRevertOperationStore(db)
    store.begin({
      threadId: "thread-worktree",
      turnCount: 1,
      currentTurnCount: 2,
      updatedAt: "2026-01-01T00:01:00.000Z",
      cwd: firstWorktree,
      providerKind: "claude",
      providerInstanceId: "claude-main",
      targetCheckpointRef: "refs/checkpoints/1",
      currentCheckpointRef: "refs/checkpoints/2",
      staleCheckpointRefs: ["refs/checkpoints/2"],
      preserveFuture: false,
    })

    expect(store.blockingThreadForCwd(secondWorktree)).toBe("thread-worktree")
  })
})
