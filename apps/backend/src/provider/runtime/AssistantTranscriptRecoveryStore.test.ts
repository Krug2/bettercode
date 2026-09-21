import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ThreadMessageUpsertRequest } from "../../services/threads/types"
import { AssistantTranscriptRecoveryStore } from "./AssistantTranscriptRecoveryStore"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function makeDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "betterc0de-transcript-recovery-")
  )
  directories.push(directory)
  return directory
}

function request(
  threadId = "thread-1",
  content = "durable assistant output"
): ThreadMessageUpsertRequest {
  return {
    thread_id: threadId,
    message: {
      message_id: `provider-assistant:${threadId}:turn-1`,
      turn_id: "turn-1",
      role: "assistant",
      content,
      created_at: "2026-07-11T04:00:00.000Z",
      extra: {
        reasoning: "bounded reasoning",
        toolCalls: [{ id: "tool-1", name: "Read", input: { path: "a.ts" } }],
      },
    },
  }
}

const metadata = {
  reason: "retry_exhausted" as const,
  truncated: false,
}

describe("AssistantTranscriptRecoveryStore", () => {
  it("atomically spools and replays a failed transcript", () => {
    const directory = makeDirectory()
    const store = new AssistantTranscriptRecoveryStore(directory)
    const upsertMessage = vi.fn()
    const recoveryRequest = request()

    expect(store.enqueue(recoveryRequest, metadata)).toBe(true)
    expect(store.pendingCount()).toBe(1)
    expect(fs.readdirSync(directory).some((entry) => entry.endsWith(".tmp"))).toBe(
      false
    )

    expect(store.replay({ upsertMessage })).toEqual({
      replayed: 1,
      discarded: 0,
      quarantined: 0,
      pending: 0,
    })
    expect(upsertMessage).toHaveBeenCalledWith(recoveryRequest)
    expect(store.pendingCount()).toBe(0)
  })

  it("keeps a record pending until the database accepts it", () => {
    const store = new AssistantTranscriptRecoveryStore(makeDirectory())
    store.enqueue(request(), metadata)
    const upsertMessage = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sqlite is busy")
      })
      .mockImplementation(() => undefined)

    expect(store.replay({ upsertMessage }).pending).toBe(1)
    expect(store.replay({ upsertMessage }).pending).toBe(0)
    expect(upsertMessage).toHaveBeenCalledTimes(2)
  })

  it("stops an ordered replay when an earlier record is still unavailable", () => {
    let now = Date.parse("2026-07-11T04:00:00.000Z")
    const store = new AssistantTranscriptRecoveryStore(makeDirectory(), {
      now: () => new Date(now++),
    })
    store.enqueue(request("thread-1", "first"), metadata)
    store.enqueue(request("thread-2", "second"), metadata)
    const upsertMessage = vi.fn((_value: ThreadMessageUpsertRequest): void => {
      throw Object.assign(new Error("sqlite is busy"), { code: "SQLITE_BUSY" })
    })

    expect(store.replay({ upsertMessage }).pending).toBe(2)
    expect(upsertMessage).toHaveBeenCalledTimes(1)

    upsertMessage.mockImplementation(() => undefined)
    expect(store.replay({ upsertMessage }).pending).toBe(0)
    expect(upsertMessage.mock.calls.map(([value]) => value.thread_id)).toEqual([
      "thread-1",
      "thread-1",
      "thread-2",
    ])
  })

  it("isolates a record-specific replay failure to its owning thread", () => {
    let now = Date.parse("2026-07-11T04:00:00.000Z")
    const store = new AssistantTranscriptRecoveryStore(makeDirectory(), {
      now: () => new Date(now++),
    })
    store.enqueue(request("thread-blocked", "blocked first"), metadata)
    store.enqueue(request("thread-blocked", "blocked second"), metadata)
    store.enqueue(request("thread-independent", "independent"), metadata)
    const upsertMessage = vi.fn((value: ThreadMessageUpsertRequest): void => {
      if (value.thread_id === "thread-blocked") {
        throw new Error("record-specific constraint")
      }
    })

    const result = store.replay({ upsertMessage }, { maxRecords: 2 })

    expect(result.replayed).toBe(1)
    expect(result.pending).toBe(2)
    expect(upsertMessage.mock.calls.map(([value]) => value.thread_id)).toEqual([
      "thread-blocked",
      "thread-independent",
    ])
  })

  it("bounds each replay batch and continues with the remaining records", () => {
    let now = Date.parse("2026-07-11T04:00:00.000Z")
    const store = new AssistantTranscriptRecoveryStore(makeDirectory(), {
      now: () => new Date(now++),
    })
    store.enqueue(request("thread-1"), metadata)
    store.enqueue(request("thread-2"), metadata)
    store.enqueue(request("thread-3"), metadata)
    const upsertMessage = vi.fn()

    expect(store.replay({ upsertMessage }, { maxRecords: 2 })).toEqual({
      replayed: 2,
      discarded: 0,
      quarantined: 0,
      pending: 1,
    })
    expect(store.replay({ upsertMessage }, { maxRecords: 2 })).toEqual({
      replayed: 1,
      discarded: 0,
      quarantined: 0,
      pending: 0,
    })
  })

  it("keeps immutable recovery records idempotent at replay", () => {
    let now = Date.parse("2026-07-11T04:00:00.000Z")
    const store = new AssistantTranscriptRecoveryStore(makeDirectory(), {
      now: () => new Date(now++),
    })

    expect(store.enqueue(request("thread-1", "first copy"), metadata)).toBe(true)
    expect(store.enqueue(request("thread-1", "latest copy"), metadata)).toBe(true)
    expect(store.pendingCount()).toBe(2)
    const upsertMessage = vi.fn()
    store.replay({ upsertMessage })

    expect(upsertMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ content: "latest copy" }),
      })
    )
    expect(store.pendingCount()).toBe(0)
  })

  it("quarantines malformed records and discards records for deleted threads", () => {
    const directory = makeDirectory()
    const store = new AssistantTranscriptRecoveryStore(directory)
    store.enqueue(request("deleted-thread"), metadata)
    fs.writeFileSync(
      path.join(
        directory,
        `0000000000000-0000000000000-${"a".repeat(32)}-00000000-0000-4000-8000-000000000000.json`
      ),
      "{broken"
    )

    const result = store.replay({
      upsertMessage: () => {
        throw Object.assign(new Error("thread missing"), { statusCode: 404 })
      },
    })

    expect(result).toEqual({
      replayed: 0,
      discarded: 1,
      quarantined: 1,
      pending: 0,
    })
    expect(fs.readdirSync(path.join(directory, "quarantine"))).toHaveLength(1)
    expect(store.removeThread("deleted-thread")).toBe(1)
    expect(fs.readdirSync(path.join(directory, "quarantine"))).toHaveLength(0)
  })

  it("quarantines a recovery record whose payload checksum was altered", () => {
    const directory = makeDirectory()
    const store = new AssistantTranscriptRecoveryStore(directory)
    store.enqueue(request(), metadata)
    const record = fs
      .readdirSync(directory)
      .find((entry) => entry.endsWith(".json"))!
    const recordPath = path.join(directory, record)
    const original = fs.readFileSync(recordPath, "utf8")
    fs.writeFileSync(
      recordPath,
      original.replace("durable assistant output", "tampered assistant output"),
      "utf8"
    )

    expect(store.replay({ upsertMessage: vi.fn() })).toEqual({
      replayed: 0,
      discarded: 0,
      quarantined: 1,
      pending: 0,
    })
  })

  it("refuses new records when the bounded spool is full", () => {
    const store = new AssistantTranscriptRecoveryStore(makeDirectory(), {
      maxFiles: 1,
      maxBytes: 10_000,
    })

    expect(store.enqueue(request("thread-1"), metadata)).toBe(true)
    expect(store.enqueue(request("thread-2"), metadata)).toBe(false)
    expect(store.pendingCount()).toBe(1)
  })

  it("removes only recovery records owned by the deleted thread", () => {
    const store = new AssistantTranscriptRecoveryStore(makeDirectory())
    store.enqueue(request("thread-delete"), metadata)
    store.enqueue(request("thread-keep"), metadata)

    expect(store.removeThread("thread-delete")).toBe(1)
    expect(store.pendingCount()).toBe(1)
    const upsertMessage = vi.fn()
    store.replay({ upsertMessage })
    expect(upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_id: "thread-keep" })
    )
  })

  it("removes quarantined recovery data owned by a deleted thread", () => {
    const directory = makeDirectory()
    const store = new AssistantTranscriptRecoveryStore(directory)
    store.enqueue(request("thread-delete"), metadata)
    const record = fs
      .readdirSync(directory)
      .find((entry) => entry.endsWith(".json"))!
    const recordPath = path.join(directory, record)
    fs.writeFileSync(
      recordPath,
      fs
        .readFileSync(recordPath, "utf8")
        .replace("durable assistant output", "tampered assistant output"),
      "utf8"
    )
    store.replay({ upsertMessage: vi.fn() })
    expect(fs.readdirSync(path.join(directory, "quarantine"))).toHaveLength(1)

    expect(store.removeThread("thread-delete")).toBe(1)
    expect(fs.readdirSync(path.join(directory, "quarantine"))).toHaveLength(0)
  })

  it("counts crash leftovers against the physical spool bound", () => {
    const directory = makeDirectory()
    fs.writeFileSync(path.join(directory, "orphan.tmp"), "crash residue")
    const store = new AssistantTranscriptRecoveryStore(directory, {
      maxFiles: 1,
      maxBytes: 10_000,
    })

    expect(store.enqueue(request(), metadata)).toBe(false)
    expect(store.pendingCount()).toBe(0)
  })
})
