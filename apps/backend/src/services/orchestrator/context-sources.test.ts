import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { createContextSourceReader } from "./context-sources"

const databases: Database.Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function fixture() {
  const db = new Database(":memory:")
  databases.push(db)
  db.exec(`
    CREATE TABLE projection_threads(thread_id TEXT PRIMARY KEY, title TEXT, status TEXT);
    CREATE TABLE projection_messages(thread_id TEXT, role TEXT, content_json TEXT, sequence INTEGER);
    CREATE TABLE projection_thread_activities(thread_id TEXT, kind TEXT, payload_json TEXT, created_at TEXT, activity_id TEXT);
    INSERT INTO projection_threads VALUES('source', 'Authentication', 'active');
  `)
  const read = createContextSourceReader(db)
  let sequence = 0
  const message = (role: string, text: string, extra: object = {}) =>
    db
      .prepare("INSERT INTO projection_messages VALUES (?, ?, ?, ?)")
      .run("source", role, JSON.stringify({ text, extra }), ++sequence)
  const plan = (text: string, at: string) =>
    db
      .prepare(
        "INSERT INTO projection_thread_activities VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "source",
        "turn.proposed.completed",
        JSON.stringify({ planMarkdown: text }),
        at,
        at
      )
  return { db, read, message, plan }
}

describe("explicit thread snapshots", () => {
  it("copies visible text in order without tools, reasoning or hidden handoffs", () => {
    const f = fixture()
    f.message("user", "Implement auth", {
      attachments: [{ token: "secret attachment" }],
    })
    f.message("system", "system secret")
    f.message("tool", "tool secret")
    f.message("assistant", "hidden secret", {
      internalContext: "provider-handoff",
    })
    f.message("assistant", "Validate the token", {
      reasoning: "private reasoning",
      toolCalls: [{ result: "tool secret" }],
    })
    const snapshot = f.read({ kind: "thread", threadId: "source" })
    expect(snapshot).toMatchObject({
      title: "Authentication",
      body: "user: Implement auth\n\nassistant: Validate the token",
      truncated: false,
    })
    expect(() => f.read({ kind: "thread", threadId: "missing" })).toThrow(
      "not found"
    )
    expect(() =>
      f.read({ kind: "thread", threadId: "source' OR 1=1 --" })
    ).toThrow("not found")
  })

  it("reports truncation and keeps the most recent messages within 12000 characters", () => {
    const f = fixture()
    for (let i = 0; i < 102; i++) f.message("user", `message ${i}`)
    const snapshot = f.read({ kind: "thread", threadId: "source" })
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.body.startsWith("user: message 2\n")).toBe(true)
    expect(snapshot.body.endsWith("user: message 101")).toBe(true)
    f.message("assistant", "x".repeat(20000))
    const oversized = f.read({ kind: "thread", threadId: "source" })
    expect(oversized.body).toHaveLength(12000)
    expect(oversized.truncated).toBe(true)
  })

  it("captures the latest saved plan and fails explicitly for empty or archived sources", () => {
    const f = fixture()
    expect(() => f.read({ kind: "thread", threadId: "source" })).toThrow(
      "no visible text"
    )
    expect(() => f.read({ kind: "plan", threadId: "source" })).toThrow(
      "no saved proposed plan"
    )
    f.plan("old plan", "2026-09-19")
    f.plan("new plan", "2026-09-20")
    expect(f.read({ kind: "plan", threadId: "source" })).toMatchObject({
      body: "new plan",
      title: "Plan: Authentication",
      truncated: false,
    })
    f.plan("x".repeat(12001), "2026-09-21")
    expect(f.read({ kind: "plan", threadId: "source" })).toMatchObject({
      truncated: true,
      body: "x".repeat(12000),
    })
    f.db.prepare("UPDATE projection_threads SET status = 'archived'").run()
    expect(() => f.read({ kind: "plan", threadId: "source" })).toThrow(
      "not found"
    )
  })
})
