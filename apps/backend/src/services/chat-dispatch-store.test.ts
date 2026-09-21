import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDatabase, type Db } from "../persistence/db"
import { runMigrations } from "../persistence/migrations"
import { ProviderSessionBindingStore } from "../provider/runtime/ProviderSessionBindingStore"
import { ThreadService } from "./threads"
import {
  ChatDispatchConflictError,
  ChatDispatchStore,
  ChatDispatchTransitionError,
  chatDispatchFingerprint,
  recoverChatDispatchesAfterRestart,
  type ChatDispatchReservation,
} from "./chat-dispatch-store"

const tempDirs: string[] = []

describe("ChatDispatchStore", () => {
  let db: Db
  let threads: ThreadService
  let dispatches: ChatDispatchStore

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-dispatch-"))
    tempDirs.push(dir)
    db = openDatabase(path.join(dir, "state.db"))
    runMigrations(db)
    threads = new ThreadService(db)
    dispatches = new ChatDispatchStore(db)
  })

  afterEach(() => {
    db.close()
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rolls back the user message and thread when the outbox insert fails", () => {
    db.exec(`
      CREATE TRIGGER fail_chat_dispatch_insert
      BEFORE INSERT ON chat_dispatches
      BEGIN
        SELECT RAISE(ABORT, 'forced outbox failure');
      END;
    `)

    expect(() => reserve("message-atomic", "atomic", "claude-main")).toThrow(
      "forced outbox failure"
    )
    expect(
      db.prepare("SELECT 1 FROM projection_threads WHERE thread_id = ?").get(
        "thread-1"
      )
    ).toBeUndefined()
    expect(
      db.prepare("SELECT 1 FROM projection_messages WHERE message_id = ?").get(
        "message-atomic"
      )
    ).toBeUndefined()
  })

  it("treats the message id as an immutable request identity", () => {
    const first = reserve("message-stable", "hello", "claude-main")
    expect(first.kind).toBe("created")
    expect(reserve("message-stable", "hello", "claude-main").kind).toBe(
      "existing"
    )

    expect(() => reserve("message-stable", "changed", "claude-main")).toThrow(
      ChatDispatchConflictError
    )
    expect(() => reserve("message-stable", "hello", "claude-other")).toThrow(
      ChatDispatchConflictError
    )
  })

  it("persists accepted and late-failed lifecycle metadata", () => {
    reserve("message-lifecycle", "hello", "claude-main")
    expect(message("message-lifecycle")).toMatchObject({
      dispatchStatus: "pending",
    })

    dispatches.markAccepted({
      dispatchId: "message-lifecycle",
      providerTurnId: "turn-1",
      providerInstanceId: "claude-main",
    })
    expect(dispatches.get("message-lifecycle")).toMatchObject({
      status: "accepted",
      providerTurnId: "turn-1",
    })
    const acceptedMessage = message("message-lifecycle")
    expect(acceptedMessage).toMatchObject({
      dispatchStatus: "accepted",
    })
    expect(acceptedMessage).not.toHaveProperty("dispatchFailed")

    dispatches.markFailed("message-lifecycle", new Error("late rejection"))
    expect(dispatches.get("message-lifecycle")).toMatchObject({
      status: "failed",
      lastError: "late rejection",
    })
    expect(message("message-lifecycle")).toMatchObject({
      dispatchStatus: "failed",
      dispatchFailed: true,
    })
  })

  it("applies a completed terminal receipt idempotently", () => {
    reserve("message-completed", "done", null)
    dispatches.bindProviderTurn({
      dispatchId: "message-completed",
      providerTurnId: "dispatch-turn-completed",
      providerInstanceId: "inferred-runtime-instance",
    })

    expect(
      dispatches.markCompletedByProviderTurn(
        "thread-1",
        "inferred-runtime-instance",
        "dispatch-turn-completed"
      )
    ).toMatchObject({
      status: "completed",
      providerInstanceId: "inferred-runtime-instance",
      providerTurnId: "dispatch-turn-completed",
      completedAt: expect.any(String),
    })
    expect(
      dispatches.markCompletedByProviderTurn(
        "thread-1",
        "inferred-runtime-instance",
        "dispatch-turn-completed"
      )
    ).toMatchObject({ status: "completed" })
    expect(message("message-completed")).toMatchObject({
      dispatchStatus: "completed",
    })
  })

  it("does not apply a terminal receipt from a different provider instance", () => {
    reserve("message-instance-bound", "bound", "claude-main")
    dispatches.markAccepted({
      dispatchId: "message-instance-bound",
      providerTurnId: "shared-turn-id",
      providerInstanceId: "claude-main",
    })

    expect(
      dispatches.markCompletedByProviderTurn(
        "thread-1",
        "claude-other",
        "shared-turn-id"
      )
    ).toBeNull()
    expect(dispatches.get("message-instance-bound")).toMatchObject({
      status: "accepted",
      providerInstanceId: "claude-main",
    })
    expect(
      dispatches.markCompletedByProviderTurn(
        "thread-1",
        "claude-main",
        "shared-turn-id"
      )
    ).toMatchObject({ status: "completed" })
  })

  it.each(["pending", "accepted"] as const)(
    "rejects a different provider turn after a %s dispatch is bound",
    (status) => {
      reserve("message-turn-bound", "bound", "claude-main")
      dispatches.bindProviderTurn({
        dispatchId: "message-turn-bound",
        providerTurnId: "original-turn",
        providerInstanceId: "claude-main",
      })
      if (status === "accepted") {
        dispatches.markAccepted({
          dispatchId: "message-turn-bound",
          providerTurnId: "original-turn",
          providerInstanceId: "claude-main",
        })
      }
      const conflicting = {
        dispatchId: "message-turn-bound",
        providerTurnId: "unrelated-turn",
        providerInstanceId: "claude-main",
      }
      expect(() => dispatches.markAccepted(conflicting)).toThrow(
        ChatDispatchTransitionError
      )
      expect(() => dispatches.markCompleted(conflicting)).toThrow(
        ChatDispatchTransitionError
      )
      expect(dispatches.get("message-turn-bound")).toMatchObject({
        status,
        providerTurnId: "original-turn",
      })
      expect(message("message-turn-bound")).toMatchObject({
        dispatchStatus: status,
      })
    }
  )

  it("keeps the first terminal or revert state authoritative", () => {
    reserve("message-first-failed", "fails first", null)
    dispatches.bindProviderTurn({
      dispatchId: "message-first-failed",
      providerTurnId: "turn-first-failed",
    })
    dispatches.markFailed("message-first-failed", "provider failed")
    expect(
      dispatches.markCompleted({
        dispatchId: "message-first-failed",
        providerTurnId: "turn-first-failed",
      })
    ).toMatchObject({ status: "failed", lastError: "provider failed" })

    reserve("message-first-reverted", "revert first", null)
    dispatches.bindProviderTurn({
      dispatchId: "message-first-reverted",
      providerTurnId: "turn-first-reverted",
    })
    threads.truncateAfterMessage({
      thread_id: "thread-1",
      message_id: "message-first-failed",
      updated_at: "2026-01-01T00:05:00.000Z",
    })
    expect(
      dispatches.markCompleted({
        dispatchId: "message-first-reverted",
        providerTurnId: "turn-first-reverted",
      })
    ).toMatchObject({ status: "reverted" })
    expect(threads.getMessage("thread-1", "message-first-reverted")).toBeNull()
  })

  it("resolves a recovered bound admission from its terminal receipt", () => {
    reserve("message-recovered-terminal", "recover terminal", null)
    dispatches.bindProviderTurn({
      dispatchId: "message-recovered-terminal",
      providerTurnId: "turn-recovered-terminal",
    })
    dispatches.recoverPendingAfterRestart()

    expect(
      dispatches.markCompletedByProviderTurn(
        "thread-1",
        null,
        "turn-recovered-terminal"
      )
    ).toMatchObject({ status: "completed" })
  })

  it("recovers pending admissions as uncertain and rotates the concrete session", () => {
    reserve("message-recovery", "recover me", "claude-main")
    const bindings = new ProviderSessionBindingStore(db)
    bindings.upsert({
      threadId: "thread-1",
      providerKind: "claude",
      providerInstanceId: "claude-main",
      providerThreadId: "native-thread-1",
      continuationKey: "claude:test",
      status: "running",
      activeTurnId: "turn-before-crash",
    })

    expect(recoverChatDispatchesAfterRestart(dispatches, bindings)).toHaveLength(1)
    expect(dispatches.get("message-recovery")).toMatchObject({
      status: "uncertain",
      recoveryCompletedAt: expect.any(String),
    })
    expect(message("message-recovery")).toMatchObject({
      dispatchStatus: "uncertain",
      dispatchFailed: true,
    })
    expect(bindings.get("thread-1", "claude-main")).toMatchObject({
      generation: 1,
      providerThreadId: null,
      resumeCursor: null,
      activeTurnId: null,
    })
    expect(recoverChatDispatchesAfterRestart(dispatches, bindings)).toEqual([])
  })

  it("uses chat_dispatches as authority for history and renderer saves", () => {
    reserve("message-accepted", "accepted user", "claude-main")
    dispatches.markAccepted({
      dispatchId: "message-accepted",
      providerTurnId: "turn-accepted",
      providerInstanceId: "claude-main",
    })
    dispatches.markCompleted({
      dispatchId: "message-accepted",
      providerTurnId: "turn-accepted",
      providerInstanceId: "claude-main",
    })
    reserve("message-failed", "failed user", "claude-main")
    dispatches.markFailed("message-failed", "rejected")
    reserve("message-uncertain", "uncertain user", "claude-main")
    dispatches.recoverPendingAfterRestart()
    dispatches.completeRecovery("message-uncertain")
    reserve("message-pending", "pending user", "claude-main")

    expect(
      threads
        .buildProviderHistory("thread-1")
        .filter((entry) => entry.role === "user")
    ).toEqual([{ role: "user", content: "accepted user" }])

    const createdAt = "2026-01-01T00:00:00.000Z"
    threads.save({
      thread_id: "thread-1",
      title: "Thread",
      project_name: "project",
      project_path: "/repo",
      created_at: createdAt,
      updated_at: "2026-01-01T00:01:00.000Z",
      codex_thread_id: null,
      messages: [
        {
          message_id: "message-accepted",
          turn_id: null,
          role: "user",
          content: "renderer attempted overwrite",
          created_at: createdAt,
          extra: { dispatchStatus: "failed" },
        },
        ...["message-failed", "message-uncertain", "message-pending"].map(
          (messageId) => threads.getMessage("thread-1", messageId)!
        ),
      ],
    })
    expect(threads.getMessage("thread-1", "message-accepted")).toMatchObject({
      content: "accepted user",
      extra: { dispatchStatus: "completed" },
    })

    threads.upsertMessage({
      thread_id: "thread-1",
      message: {
        message_id: "message-accepted",
        turn_id: null,
        role: "user",
        content: "second attempted overwrite",
        created_at: createdAt,
        extra: {},
      },
    })
    expect(threads.getMessage("thread-1", "message-accepted")).toMatchObject({
      content: "accepted user",
      extra: { dispatchStatus: "completed" },
    })

    let omissionError: unknown
    try {
      threads.save({
        thread_id: "thread-1",
        title: "Thread",
        project_name: "project",
        project_path: "/repo",
        created_at: createdAt,
        updated_at: "2026-01-01T00:02:00.000Z",
        codex_thread_id: null,
        messages: [],
      })
    } catch (error) {
      omissionError = error
    }
    expect(omissionError).toMatchObject({
      statusCode: 409,
      code: "dispatch_message_omitted",
    })
  })

  it("tombstones only dispatch rows beyond an explicit truncation boundary", () => {
    reserve("message-boundary", "keep", "claude-main")
    reserve("message-future-1", "remove one", "claude-main")
    reserve("message-future-2", "remove two", "claude-main")
    const staleBoundary = threads.getMessage("thread-1", "message-boundary")!
    const staleFuture = threads.getMessage("thread-1", "message-future-1")!

    expect(
      threads.truncateAfterMessage({
        thread_id: "thread-1",
        message_id: "message-boundary",
        updated_at: "2026-01-01T00:05:00.000Z",
      })
    ).toEqual({ deletedMessages: 2 })
    expect(dispatches.get("message-boundary")).not.toBeNull()
    expect(dispatches.get("message-future-1")).toMatchObject({
      status: "reverted",
    })
    expect(dispatches.get("message-future-2")).toMatchObject({
      status: "reverted",
    })
    expect(threads.getMessage("thread-1", "message-future-1")).toBeNull()
    expect(threads.getMessage("thread-1", "message-future-2")).toBeNull()
    expect(dispatches.markFailed("message-future-1", "late rejection")).toMatchObject({
      status: "reverted",
    })

    let saveError: unknown
    try {
      threads.save({
        thread_id: "thread-1",
        title: "stale renderer save",
        project_name: "project",
        project_path: "/repo",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:06:00.000Z",
        codex_thread_id: null,
        messages: [staleBoundary, staleFuture],
      })
    } catch (error) {
      saveError = error
    }
    expect(saveError).toMatchObject({
      statusCode: 409,
      code: "dispatch_message_reverted",
    })
    expect(() =>
      threads.upsertMessage({
        thread_id: "thread-1",
        message: staleFuture,
      })
    ).toThrow(/removed by an explicit thread revert/i)
    expect(threads.getMessage("thread-1", "message-future-1")).toBeNull()
  })

  function reserve(
    messageId: string,
    content: string,
    providerInstanceId: string | null
  ) {
    const input: ChatDispatchReservation = {
      dispatchId: messageId,
      threadId: "thread-1",
      messageId,
      providerKind: "claude",
      providerInstanceId,
      requestFingerprint: chatDispatchFingerprint({
        threadId: "thread-1",
        messageId,
        content,
        providerKind: "claude",
        providerInstanceId,
      }),
    }
    return dispatches.reserve(input, () => {
      threads.persistUserMessageForTurn({
        thread_id: "thread-1",
        title: "Thread",
        project_name: "project",
        project_path: "/repo",
        created_at: "2026-01-01T00:00:00.000Z",
        message: {
          message_id: messageId,
          turn_id: null,
          role: "user",
          content,
          created_at: new Date(
            Date.parse("2026-01-01T00:00:00.000Z") +
              Number(messageId.length) * 1_000
          ).toISOString(),
          extra: {},
        },
      })
    })
  }

  function message(messageId: string): Record<string, unknown> {
    const saved = threads.getMessage("thread-1", messageId)
    expect(saved).not.toBeNull()
    return saved!.extra
  }
})
