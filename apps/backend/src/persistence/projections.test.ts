import { afterEach, describe, expect, it, vi } from "vitest"
import { logger } from "../observability/logger"
import type { Db } from "./db"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDatabase } from "./db"
import { runMigrations } from "./migrations"
import {
  CheckpointDiffProjectionQuery,
  decodeThreadActivityCursor,
  encodeThreadActivityCursor,
  ThreadActivityProjectionQuery,
  WorktreeRegistryQuery,
} from "./projections"

const databases: Array<{ db: Db; dir: string }> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const { db, dir } of databases.splice(0)) {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function openTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-projections-"))
  const db = openDatabase(path.join(dir, "test.sqlite"))
  runMigrations(db)
  databases.push({ db, dir })
  return db
}

describe("WorktreeRegistryQuery", () => {
  it("persists branch cleanup intent monotonically while removal is pending", () => {
    const db = openTestDb()
    const now = "2026-07-23T00:00:00.000Z"
    db.prepare(`
      INSERT INTO projection_threads
        (thread_id, project_id, created_at, updated_at)
      VALUES ('thread-1', 'project-1', ?, ?)
    `).run(now, now)
    const registry = new WorktreeRegistryQuery(db)
    registry.insert({
      worktree_id: "worktree-1",
      thread_id: "thread-1",
      worktree_path: "/tmp/worktree-1",
      branch: "agent/thread-1/test",
      base_branch: "main",
      base_repo_path: "/tmp/repo",
      state: "ready",
      delete_branch_on_remove: 0,
      created_at: now,
      updated_at: now,
    })

    registry.markRemoving("worktree-1", true, "2026-07-23T00:00:01.000Z")
    registry.markRemoving("worktree-1", false, "2026-07-23T00:00:02.000Z")

    expect(registry.findByThread("thread-1")).toMatchObject({
      state: "removing",
      delete_branch_on_remove: 1,
      updated_at: "2026-07-23T00:00:02.000Z",
    })
    db.close()
  })
})

describe("ThreadActivityProjectionQuery", () => {
  it("paginates duplicate and null sequences without repeats or omissions", () => {
    const db = openTestDb()
    const activities = new ThreadActivityProjectionQuery(db)
    const insert = (
      activityId: string,
      sequence: number | null,
      createdAt: string
    ) =>
      activities.upsert({
        activity_id: activityId,
        thread_id: "thread-1",
        turn_id: null,
        kind: "test",
        tone: "info",
        summary: activityId,
        payload: { activityId },
        sequence,
        created_at: createdAt,
      })

    insert("sequence-5-new", 5, "2026-07-23T00:00:03.000Z")
    insert("sequence-5-old", 5, "2026-07-23T00:00:02.000Z")
    insert("sequence-4", 4, "2026-07-23T00:00:04.000Z")
    insert("null-z", null, "2026-07-23T00:00:05.000Z")
    insert("null-a", null, "2026-07-23T00:00:05.000Z")

    const first = activities.listByThreadPage("thread-1", { limit: 2 })
    expect(first.items.map((item) => item.activity_id)).toEqual([
      "sequence-5-old",
      "sequence-5-new",
    ])
    expect(first.next).toEqual({
      sequence: 5,
      createdAt: "2026-07-23T00:00:02.000Z",
      activityId: "sequence-5-old",
    })

    const second = activities.listByThreadPage("thread-1", {
      limit: 2,
      before: first.next,
    })
    expect(second.items.map((item) => item.activity_id)).toEqual([
      "null-z",
      "sequence-4",
    ])
    expect(second.next).toEqual({
      sequence: null,
      createdAt: "2026-07-23T00:00:05.000Z",
      activityId: "null-z",
    })

    const third = activities.listByThreadPage("thread-1", {
      limit: 2,
      before: second.next,
    })
    expect(third.items.map((item) => item.activity_id)).toEqual(["null-a"])
    expect(third.next).toBeNull()

    const allIds = [...first.items, ...second.items, ...third.items].map(
      (item) => item.activity_id
    )
    expect(new Set(allIds).size).toBe(5)
    expect(new Set(allIds)).toEqual(
      new Set([
        "sequence-5-new",
        "sequence-5-old",
        "sequence-4",
        "null-z",
        "null-a",
      ])
    )

    // The legacy sequence-only boundary remains accepted, but deliberately
    // excludes NULL rows because it cannot represent a stable NULL tie-break.
    expect(
      activities
        .listByThread("thread-1", { beforeSequence: 5 })
        .map((item) => item.activity_id)
    ).toEqual(["sequence-4"])
    db.close()
  })

  it("returns the single newest activity of a kind, ignoring other kinds", () => {
    const db = openTestDb()
    const activities = new ThreadActivityProjectionQuery(db)
    const insert = (
      activityId: string,
      kind: string,
      sequence: number | null,
      createdAt: string
    ) =>
      activities.upsert({
        activity_id: activityId,
        thread_id: "thread-1",
        turn_id: null,
        kind,
        tone: "info",
        summary: activityId,
        payload: { activityId },
        sequence,
        created_at: createdAt,
      })

    insert("cw-old", "context-window.updated", 1, "2026-07-23T00:00:01.000Z")
    insert("tool-1", "tool.completed", 2, "2026-07-23T00:00:02.000Z")
    insert("cw-new", "context-window.updated", 3, "2026-07-23T00:00:03.000Z")
    insert("tool-2", "tool.completed", 4, "2026-07-23T00:00:04.000Z")

    const latest = activities.latestByThreadKind(
      "thread-1",
      "context-window.updated"
    )
    expect(latest?.activity_id).toBe("cw-new")
    expect(latest?.payload).toEqual({ activityId: "cw-new" })

    expect(activities.latestByThreadKind("thread-1", "missing.kind")).toBeNull()
    expect(
      activities.latestByThreadKind("other-thread", "context-window.updated")
    ).toBeNull()
    db.close()
  })

  it("round-trips only bounded, integral activity cursors", () => {
    const cursor = {
      sequence: 12,
      createdAt: "2026-07-23T00:00:00.000Z",
      activityId: "activity-12",
    }
    expect(decodeThreadActivityCursor(encodeThreadActivityCursor(cursor))).toEqual(
      cursor
    )
    expect(decodeThreadActivityCursor("not-json")).toBe(false)
    expect(
      decodeThreadActivityCursor(
        Buffer.from(
          JSON.stringify({ ...cursor, sequence: 1.5 }),
          "utf8"
        ).toString("base64url")
      )
    ).toBe(false)
  })
})

describe("CheckpointDiffProjectionQuery", () => {
  it("persists turn.diff.updated into turn and checkpoint diff read models", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+next",
    ].join("\n")

    projection.recordRuntimeEvent(
      {
        event_type: "turn.diff.updated",
        thread_id: "thread-1",
        payload: {
          turn_index: 3,
          turn_id: "turn-3",
          checkpointRef: "refs/betterc0de/checkpoints/thread/turn/3",
          unifiedDiff: diff,
        },
      },
      "2026-05-12T10:00:00.000Z"
    )

    expect(projection.listTurnDiffsByThread("thread-1")).toEqual([
      {
        thread_id: "thread-1",
        turn_index: 3,
        diff_text: diff,
        files_changed: 1,
        insertions: 2,
        deletions: 1,
        created_at: "2026-05-12T10:00:00.000Z",
      },
    ])
    expect(projection.listCheckpointDiffsByThread("thread-1")).toMatchObject([
      {
        thread_id: "thread-1",
        turn_id: "turn-3",
        checkpoint_ref: "refs/betterc0de/checkpoints/thread/turn/3",
        diff_content: diff,
        created_at: "2026-05-12T10:00:00.000Z",
      },
    ])
    expect(projection.latestTurnIndex("thread-1")).toBe(3)
    expect(projection.latestTurnIndex("missing-thread")).toBe(0)

    const blobRows = db
      .prepare(`SELECT blob_id, diff_content FROM diff_blobs`)
      .all() as Array<{ blob_id: string; diff_content: string }>
    const turnRow = db
      .prepare(
        `SELECT diff_text, diff_blob_id FROM turn_diffs
         WHERE thread_id = ? AND turn_index = ?`
      )
      .get("thread-1", 3) as {
      diff_text: string
      diff_blob_id: string
    }
    const checkpointRow = db
      .prepare(
        `SELECT diff_content, diff_blob_id FROM checkpoint_diffs
         WHERE thread_id = ? AND turn_id = ?`
      )
      .get("thread-1", "turn-3") as {
      diff_content: string
      diff_blob_id: string
    }
    expect(blobRows).toEqual([
      {
        blob_id: turnRow.diff_blob_id,
        diff_content: diff,
      },
    ])
    expect(turnRow.diff_text).toBe("")
    expect(checkpointRow.diff_content).toBe("")
    expect(checkpointRow.diff_blob_id).toBe(turnRow.diff_blob_id)
    db.close()
  })

  it("persists the true file total for a truncated checkpoint diff", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)

    projection.recordRuntimeEvent({
      event_type: "turn.diff.updated",
      thread_id: "thread-truncated",
      payload: {
        turn_index: 4,
        turn_id: "turn-4",
        unifiedDiff: "",
        files: [
          { path: "generated/a.bin", additions: 0, deletions: 0 },
          { path: "src/main.ts", additions: 4, deletions: 1 },
        ],
        diffTruncated: true,
        diffTruncationReason: "output_limit",
        diffFileCount: 32_493,
        diffFilesTruncated: true,
      },
    })

    expect(projection.listTurnDiffsByThread("thread-truncated")).toEqual([
      expect.objectContaining({
        turn_index: 4,
        files_changed: 32_493,
        insertions: 4,
        deletions: 1,
      }),
    ])
    db.close()
  })

  it("projects a journal-bounded checkpoint summary without a patch", () => {
    const db = openTestDb()
    try {
      const projection = new CheckpointDiffProjectionQuery(db)
      projection.recordRuntimeEvent({
        event_type: "turn.diff.updated",
        thread_id: "thread-journal-limit",
        payload: {
          turn_index: 2,
          turn_id: "native-2",
          dispatchTurnId: "dispatch-2",
          checkpointRef: "refs/betterc0de/checkpoints/journal-limit/2",
          files: [{ path: "large.txt", additions: 10_000, deletions: 1 }],
          diffTruncated: true,
          diffTruncationReason: "journal_limit",
          diffFileCount: 1,
        },
      })

      expect(projection.listTurnDiffsByThread("thread-journal-limit")).toEqual([
        expect.objectContaining({
          turn_index: 2,
          diff_text: "",
          files_changed: 1,
          insertions: 10_000,
          deletions: 1,
        }),
      ])
      expect(db.prepare(`
        SELECT turn_id, dispatch_turn_id FROM turn_diffs WHERE thread_id = ?
      `).get("thread-journal-limit")).toEqual({
        turn_id: "native-2",
        dispatch_turn_id: "dispatch-2",
      })
      expect(db.prepare(`
        SELECT turn_id, checkpoint_ref FROM checkpoint_diffs WHERE thread_id = ?
      `).all("thread-journal-limit")).toEqual([{
        turn_id: "dispatch-2",
        checkpoint_ref: "refs/betterc0de/checkpoints/journal-limit/2",
      }])
    } finally {
      db.close()
    }
  })

  it("does not treat a missing patch without journal truncation as a no-op checkpoint", () => {
    const db = openTestDb()
    try {
      const projection = new CheckpointDiffProjectionQuery(db)
      projection.recordRuntimeEvent({
        event_type: "turn.diff.updated",
        thread_id: "thread-missing-patch",
        payload: {
          turn_index: 2,
          turn_id: "turn-2",
          checkpointRef: "refs/betterc0de/checkpoints/missing-patch/2",
          files: [{ path: "large.txt", additions: 10_000, deletions: 1 }],
        },
      })

      expect(projection.listTurnDiffsByThread("thread-missing-patch")).toEqual([])
      expect(db.prepare("SELECT * FROM checkpoint_diffs").all()).toEqual([])
    } finally {
      db.close()
    }
  })

  it("records exact message boundaries without counting compaction assistants", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)
    const now = "2026-05-12T10:00:00.000Z"
    db.prepare(`
      INSERT INTO projection_threads
        (thread_id, project_id, created_at, updated_at)
      VALUES ('thread-boundary', 'project-1', ?, ?)
    `).run(now, now)
    const insertMessage = db.prepare(`
      INSERT INTO projection_messages
        (message_id, thread_id, turn_id, role, content_json, created_at,
         sequence)
      VALUES (?, 'thread-boundary', ?, ?, '{}', ?, ?)
    `)
    const insertDispatch = db.prepare(`
      INSERT INTO chat_dispatches
        (dispatch_id, thread_id, message_id, provider_kind,
         request_fingerprint, status, provider_turn_id, created_at,
         updated_at, accepted_at)
      VALUES (?, 'thread-boundary', ?, 'codex', ?, 'accepted', ?, ?, ?, ?)
    `)
    const insertTerminal = db.prepare(`
      INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type,
         occurred_at, payload_json)
      VALUES (?, 'provider_runtime', 'thread-boundary', ?, ?, ?, ?)
    `)
    insertMessage.run("user-1", "turn-1", "user", now, 0)
    insertMessage.run("assistant-1", "turn-1", "assistant", now, 1)
    insertMessage.run("compaction", null, "assistant", now, 2)
    projection.recordRuntimeEvent({
      event_type: "turn.diff.updated",
      event_id: "diff-1",
      thread_id: "thread-boundary",
      payload: {
        turn_index: 1,
        turn_id: "turn-1",
        unifiedDiff: "diff --git a/one b/one",
      },
    })

    expect(
      db
        .prepare(
          `SELECT turn_count FROM projection_threads
           WHERE thread_id = 'thread-boundary'`
        )
        .get()
    ).toEqual({ turn_count: 1 })

    insertMessage.run("user-2", null, "user", now, 3)
    insertMessage.run("assistant-2", "native-2", "assistant", now, 4)
    insertDispatch.run(
      "dispatch-row-2",
      "user-2",
      "fingerprint-2",
      "dispatch-2",
      now,
      now,
      now
    )
    insertTerminal.run(
      "terminal-2",
      1,
      "ProviderRuntime:turn_completed",
      now,
      JSON.stringify({
        event_type: "turn_completed",
        thread_id: "thread-boundary",
        payload: {
          turn_id: "native-2",
          dispatchTurnId: "dispatch-2",
        },
      })
    )
    projection.recordRuntimeEvent({
      event_type: "turn.diff.updated",
      event_id: "diff-2",
      thread_id: "thread-boundary",
      payload: {
        source: "checkpoint_reactor",
        turn_index: 2,
        turn_id: "dispatch-2",
        unifiedDiff: "diff --git a/two b/two",
      },
    })

    insertMessage.run("user-failed", null, "user", now, 5)
    insertDispatch.run(
      "dispatch-row-failed",
      "user-failed",
      "fingerprint-failed",
      "dispatch-failed",
      now,
      now,
      now
    )
    insertTerminal.run(
      "terminal-failed",
      2,
      "ProviderRuntime:turn_error",
      now,
      JSON.stringify({
        event_type: "turn_error",
        thread_id: "thread-boundary",
        payload: {
          turn_id: "native-failed",
          dispatchTurnId: "dispatch-failed",
        },
      })
    )
    insertMessage.run("future-user", null, "user", now, 6)
    projection.recordRuntimeEvent({
      event_type: "turn.diff.updated",
      event_id: "diff-3",
      thread_id: "thread-boundary",
      payload: {
        source: "checkpoint_reactor",
        turn_index: 3,
        turn_id: "dispatch-failed",
        unifiedDiff: "diff --git a/failed b/failed",
      },
    })

    expect(
      db
        .prepare(`
          SELECT
            turn_index,
            turn_id,
            dispatch_turn_id,
            boundary_message_id,
            boundary_sequence
          FROM turn_diffs
          WHERE thread_id = 'thread-boundary'
          ORDER BY turn_index
        `)
        .all()
    ).toEqual([
      {
        turn_index: 1,
        turn_id: "turn-1",
        dispatch_turn_id: null,
        boundary_message_id: "assistant-1",
        boundary_sequence: 1,
      },
      {
        turn_index: 2,
        turn_id: "native-2",
        dispatch_turn_id: "dispatch-2",
        boundary_message_id: "assistant-2",
        boundary_sequence: 4,
      },
      {
        turn_index: 3,
        turn_id: "native-failed",
        dispatch_turn_id: "dispatch-failed",
        boundary_message_id: "user-failed",
        boundary_sequence: 5,
      },
    ])
    expect(
      db
        .prepare(
          `SELECT turn_count FROM projection_threads
           WHERE thread_id = 'thread-boundary'`
        )
        .get()
    ).toEqual({ turn_count: 3 })
    db.close()
  })

  it("persists no-op checkpoint turns with an empty unified diff", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)
    const now = "2026-05-12T10:00:00.000Z"
    db.prepare(`
      INSERT INTO projection_threads
        (thread_id, project_id, created_at, updated_at)
      VALUES ('thread-no-op', 'project-1', ?, ?)
    `).run(now, now)
    db.prepare(`
      INSERT INTO projection_messages
        (message_id, thread_id, turn_id, role, content_json, created_at,
         sequence)
      VALUES
        ('user-no-op', 'thread-no-op', NULL, 'user', '{}', ?, 0),
        ('assistant-no-op', 'thread-no-op', 'turn-no-op', 'assistant', '{}',
         ?, 1)
    `).run(now, now)

    projection.recordRuntimeEvent(
      {
        event_type: "turn.diff.updated",
        thread_id: "thread-no-op",
        payload: {
          turn_index: 1,
          turn_id: "turn-no-op",
          checkpointRef: "refs/checkpoints/no-op",
          unifiedDiff: "",
        },
      },
      now
    )

    expect(
      db
        .prepare(`
          SELECT
            turn_index,
            turn_id,
            boundary_message_id,
            boundary_sequence
          FROM turn_diffs
          WHERE thread_id = 'thread-no-op'
        `)
        .get()
    ).toEqual({
      turn_index: 1,
      turn_id: "turn-no-op",
      boundary_message_id: "assistant-no-op",
      boundary_sequence: 1,
    })
    expect(projection.listTurnDiffsByThread("thread-no-op")).toMatchObject([
      {
        turn_index: 1,
        diff_text: "",
        files_changed: 0,
        insertions: 0,
        deletions: 0,
      },
    ])
    expect(
      projection.listCheckpointDiffsByThread("thread-no-op")
    ).toMatchObject([
      {
        turn_id: "turn-no-op",
        checkpoint_ref: "refs/checkpoints/no-op",
        diff_content: "",
      },
    ])
    expect(projection.latestTurnIndex("thread-no-op")).toBe(1)
    db.close()
  })

  it("updates the per-turn summary without duplicating checkpoint ref rows", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)
    const firstDiff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n")
    const secondDiff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+next",
    ].join("\n")

    const event = {
      event_type: "turn.diff.updated",
      thread_id: "thread-1",
      payload: {
        turn_index: 1,
        turn_id: "turn-1",
        checkpointRef: "refs/betterc0de/checkpoints/thread/turn/1",
      },
    }
    projection.recordRuntimeEvent(
      {
        ...event,
        payload: { ...event.payload, unifiedDiff: firstDiff },
      },
      "2026-05-12T10:00:00.000Z"
    )
    projection.recordRuntimeEvent(
      {
        ...event,
        payload: { ...event.payload, unifiedDiff: secondDiff },
      },
      "2026-05-12T10:00:01.000Z"
    )

    expect(projection.listTurnDiffsByThread("thread-1")[0]).toMatchObject({
      turn_index: 1,
      diff_text: secondDiff,
      files_changed: 1,
      insertions: 2,
      deletions: 1,
      created_at: "2026-05-12T10:00:01.000Z",
    })
    expect(projection.listCheckpointDiffsByThread("thread-1")).toHaveLength(1)
    expect(projection.listCheckpointDiffsByThread("thread-1")[0]).toMatchObject(
      {
        diff_content: secondDiff,
      }
    )
    db.close()
  })

  it("keeps provider-native diffs without checkpoint refs addressable by turn", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)
    const firstDiff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n")
    const secondDiff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+next",
    ].join("\n")

    projection.recordRuntimeEvent(
      {
        event_type: "turn.diff.updated",
        thread_id: "thread-1",
        payload: {
          event_id: "event-1",
          turn_id: "turn-1",
          unifiedDiff: firstDiff,
        },
      },
      "2026-05-12T10:00:00.000Z"
    )
    projection.recordRuntimeEvent(
      {
        event_type: "turn.diff.updated",
        thread_id: "thread-1",
        payload: {
          event_id: "event-2",
          turn_id: "turn-1",
          unifiedDiff: secondDiff,
        },
      },
      "2026-05-12T10:00:01.000Z"
    )
    // Replaying the same provider-native diff must preserve its sole blob
    // reference even when there is no turn_index row retaining the blob.
    projection.recordRuntimeEvent({
      event_type: "turn.diff.updated",
      thread_id: "thread-1",
      payload: { event_id: "event-2", turn_id: "turn-1", unifiedDiff: secondDiff },
    }, "2026-05-12T10:00:01.000Z")

    expect(projection.listTurnDiffsByThread("thread-1")).toEqual([])
    expect(projection.listCheckpointDiffsByThread("thread-1")).toMatchObject([
      {
        thread_id: "thread-1",
        turn_id: "turn-1",
        checkpoint_ref: "provider-diff:event-1",
        diff_content: secondDiff,
        created_at: "2026-05-12T10:00:01.000Z",
      },
    ])
    db.close()
  })
})

function explainPlan(db: Db, sql: string): string {
  const params = Array.from(
    { length: (sql.match(/\?/g) ?? []).length },
    () => "x"
  )
  return (
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
      detail: string
    }>
  )
    .map((row) => row.detail)
    .join("\n")
}

function statementSource(owner: object, name: string): string {
  const statement = (owner as Record<string, { source: string }>)[name]
  if (!statement) throw new Error(`unknown statement ${name}`)
  return statement.source
}


describe("ThreadActivityProjectionQuery query plans", () => {
  it("serves every ordered page query from idx_thread_activities_page without a temp b-tree", () => {
    const db = openTestDb()
    const activities = new ThreadActivityProjectionQuery(db)
    for (const name of [
      "listNewestByThreadStmt",
      "listBeforeSequenceStmt",
      "listBeforeNonNullCursorStmt",
      "latestByThreadKindStmt",
    ]) {
      const plan = explainPlan(db, statementSource(activities, name))
      expect(plan, name).toContain("idx_thread_activities_page")
      expect(plan, name).not.toContain("USE TEMP B-TREE")
    }
    db.close()
  })

  it("orders NULL sequences after numbered ones without a CASE term", () => {
    const db = openTestDb()
    const activities = new ThreadActivityProjectionQuery(db)
    for (const [id, sequence] of [
      ["null-one", null],
      ["seq-2", 2],
      ["seq-9", 9],
    ] as const) {
      activities.upsert({
        activity_id: id,
        thread_id: "thread-1",
        turn_id: null,
        kind: "test",
        tone: "info",
        summary: id,
        payload: {},
        sequence,
        created_at: "2026-07-23T00:00:00.000Z",
      })
    }
    expect(
      activities.listByThread("thread-1").map((item) => item.activity_id)
    ).toEqual(["null-one", "seq-2", "seq-9"])
    expect(activities.latestByThreadKind("thread-1", "test")?.activity_id).toBe(
      "seq-9"
    )
    db.close()
  })

  it("logs a corrupt payload with its identity instead of swallowing it", () => {
    const db = openTestDb()
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    const activities = new ThreadActivityProjectionQuery(db)
    activities.upsert({
      activity_id: "broken",
      thread_id: "thread-1",
      turn_id: null,
      kind: "tool",
      tone: "tool",
      summary: "broken",
      payload: { fine: true },
      sequence: 1,
      created_at: "2026-07-23T00:00:00.000Z",
    })
    db.prepare(
      "UPDATE projection_thread_activities SET payload_json = '{oops' WHERE activity_id = 'broken'"
    ).run()

    expect(activities.latestByThreadKind("thread-1", "tool")?.payload).toEqual({})
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", activityId: "broken" }),
      expect.stringContaining("corrupt")
    )
    warn.mockRestore()
    db.close()
  })
})

describe("CheckpointDiffProjectionQuery native turn lookup", () => {
  it("resolves the native turn id of a dispatch from a canonical (schema 3) journal row", () => {
    const db = openTestDb()
    const projection = new CheckpointDiffProjectionQuery(db)
    const now = "2026-09-11T10:00:00.000Z"
    db.prepare(`
      INSERT INTO projection_threads
        (thread_id, project_id, created_at, updated_at)
      VALUES ('thread-canonical', 'project-1', ?, ?)
    `).run(now, now)
    db.prepare(`
      INSERT INTO projection_messages
        (message_id, thread_id, turn_id, role, content_json, created_at,
         sequence)
      VALUES ('assistant-native', 'thread-canonical', 'native-turn-9',
              'assistant', '{}', ?, 1)
    `).run(now)
    // A canonical row keeps the native turn id at the event root and the
    // hub-injected dispatch id inside `payload`; the legacy `$.payload.turn_id`
    // path is absent.
    db.prepare(`
      INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type,
         occurred_at, payload_json, metadata_json)
      VALUES ('canonical-terminal', 'provider_runtime', 'thread-canonical', 1,
              'ProviderRuntime:turn.completed', ?, ?, ?)
    `).run(
      now,
      JSON.stringify({
        type: "turn.completed",
        threadId: "thread-canonical",
        eventId: "evt-terminal",
        turnId: "native-turn-9",
        status: "completed",
        payload: { state: "completed", dispatchTurnId: "dispatch-9" },
      }),
      JSON.stringify({ schema: 3, contract: "provider-runtime-event" })
    )

    projection.recordRuntimeEvent({
      event_type: "turn.diff.updated",
      thread_id: "thread-canonical",
      payload: {
        source: "checkpoint_reactor",
        turn_index: 1,
        turn_id: "dispatch-9",
        unifiedDiff: "diff --git a/x b/x",
      },
    })

    expect(
      db
        .prepare(
          `SELECT turn_id, dispatch_turn_id, boundary_message_id
           FROM turn_diffs WHERE thread_id = 'thread-canonical'`
        )
        .all()
    ).toEqual([
      {
        turn_id: "native-turn-9",
        dispatch_turn_id: "dispatch-9",
        boundary_message_id: "assistant-native",
      },
    ])
    db.close()
  })
})
