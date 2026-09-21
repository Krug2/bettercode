import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDatabase, type Db } from "../../persistence/db"
import { runMigrations } from "../../persistence/migrations"
import { ThreadService } from "../threads/service"
import { UsageService } from "./service"

describe("recorded usage", () => {
  let db: Db
  beforeEach(() => { db = openDatabase(":memory:"); runMigrations(db) })
  afterEach(() => db.close())

  it("reads costs from recorded responses and refreshes after a change", () => {
    const threads = new ThreadService(db)
    const usage = new UsageService(db)
    expect(usage.dashboard("UTC").calls).toBe(0)
    threads.save({
      thread_id: "t", title: "Test", project_name: "test", project_path: "/test", codex_thread_id: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      messages: [{ message_id: "m", turn_id: null, role: "assistant", content: "", created_at: "2026-01-01T00:00:00Z", extra: { modelId: "example", providerKind: "openai", usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 20, totalCostUsd: 0.125 } } }],
    })
    expect(usage.dashboard("UTC")).toMatchObject({ calls: 1, tokens: 140, cost: 0.125, unreported: 0 })
    expect(usage.dashboard("America/Chicago").days[0].date).toBe("2025-12-31")
  })
})
