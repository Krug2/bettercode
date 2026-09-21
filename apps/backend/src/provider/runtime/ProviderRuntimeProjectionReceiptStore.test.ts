import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDatabase } from "../../persistence/db"
import { EventStore } from "../../persistence/eventStore"
import { runMigrations } from "../../persistence/migrations"
import { ProviderRuntimeProjectionReceiptStore } from "./ProviderRuntimeProjectionReceiptStore"

describe("ProviderRuntimeProjectionReceiptStore", () => {
  it("records projected and bounded discarded outcomes idempotently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-provider-receipt-"))
    const db = openDatabase(path.join(dir, "test.sqlite"))
    runMigrations(db)
    const events = new EventStore(db)
    const [event] = events.append([
      {
        event_id: "provider-event-1",
        aggregate_kind: "provider_runtime",
        stream_id: "thread-1",
        stream_version: 1,
        event_type: "ProviderRuntime:turn_completed",
        occurred_at: new Date().toISOString(),
        command_id: null,
        causation_event_id: null,
        correlation_id: null,
        actor_kind: "provider",
        payload_json: "{}",
        metadata_json: "{}",
      },
    ])
    const receipts = new ProviderRuntimeProjectionReceiptStore(db)

    receipts.markProjected(event.sequence)
    expect(receipts.get(event.sequence)).toMatchObject({
      status: "projected",
      error: null,
    })

    receipts.markDiscarded(event.sequence, "x".repeat(10_000))
    const discarded = receipts.get(event.sequence)
    expect(discarded).toMatchObject({ status: "discarded" })
    expect(discarded?.error).toHaveLength(4_096)

    receipts.markProjected(event.sequence)
    expect(receipts.get(event.sequence)).toMatchObject({
      status: "projected",
      error: null,
    })
    db.close()
  })

  it("counts startup replay attempts per row and forgets them once the row is receipted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-provider-receipt-"))
    const db = openDatabase(path.join(dir, "test.sqlite"))
    runMigrations(db)
    const events = new EventStore(db)
    const [event] = events.append([
      {
        event_id: "provider-event-2",
        aggregate_kind: "provider_runtime",
        stream_id: "thread-1",
        stream_version: 1,
        event_type: "ProviderRuntime:turn_completed",
        occurred_at: new Date().toISOString(),
        command_id: null,
        causation_event_id: null,
        correlation_id: null,
        actor_kind: "provider",
        payload_json: "{}",
        metadata_json: "{}",
      },
    ])
    const receipts = new ProviderRuntimeProjectionReceiptStore(db)

    expect(receipts.replayAttempts(event.sequence)).toBe(0)
    expect(receipts.recordReplayAttempt(event.sequence, "boom")).toBe(1)
    expect(receipts.recordReplayAttempt(event.sequence, "boom again")).toBe(2)
    // Filling in the reason after the fact does not count another attempt.
    receipts.noteReplayAttemptError(event.sequence, "the real reason")
    expect(receipts.replayAttempts(event.sequence)).toBe(2)
    // A second store over the same database sees the same count: this is
    // what survives a restart.
    expect(
      new ProviderRuntimeProjectionReceiptStore(db).replayAttempts(event.sequence)
    ).toBe(2)

    receipts.markProjected(event.sequence)
    expect(receipts.replayAttempts(event.sequence)).toBe(0)
    expect(() => receipts.recordReplayAttempt(0, "x")).toThrow(/Invalid/)
    db.close()
  })
})
