import { describe, expect, it, vi } from "vitest"
import { ClaudeAdapter } from "./claude/ClaudeAdapter"
import { CodexAdapter } from "./codex/CodexAdapter"
import type { ProviderRuntimeEvent } from "./contracts"

describe("provider adapter dispatch failures", () => {
  it("propagates a rejected Codex turn start to ProviderHub", async () => {
    const adapter = new CodexAdapter({} as never)
    const sendTurn = vi.fn().mockRejectedValue(new Error("turn/start rejected"))
    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            runtime: {
              isAlive(): boolean
              requiresHistorySeed(): boolean
              sendTurn(input: unknown): Promise<void>
            }
          }
        >
      }
    ).sessions
    sessions.set("thread-1", {
      runtime: {
        isAlive: () => true,
        requiresHistorySeed: () => false,
        sendTurn,
      },
    })

    await expect(
      adapter.sendTurn({
        threadId: "thread-1",
        message: "hello",
        modelId: "gpt-5.5",
        history: [],
      } as never)
    ).rejects.toThrow("turn/start rejected")
  })

  it("terminates an accepted Claude turn when the SDK reports failure", async () => {
    const adapter = new ClaudeAdapter()
    const events: ProviderRuntimeEvent[] = []
    let consumedPastFailure = false
    adapter.subscribe((event) => events.push(event))
    ;(
      adapter as unknown as {
        loadSdk(): Promise<unknown>
      }
    ).loadSdk = vi.fn(async () => ({
      query: () =>
        (async function* () {
          yield {
            type: "result",
            subtype: "error",
            result: { error: "Claude request failed" },
          }
          consumedPastFailure = true
          yield { type: "result", subtype: "success", result: {} }
        })(),
    }))

    await adapter.sendTurn({
      threadId: "thread-2",
      message: "hello",
      modelId: "claude-opus-4-7",
      history: [],
    } as never)

    expect(consumedPastFailure).toBe(false)
    expect(events.filter((event) => event.type === "runtime.error")).toEqual([
      expect.objectContaining({ message: "Claude request failed" }),
    ])
    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "Claude request failed",
      }),
    ])
    await expect(adapter.readThread("thread-2" as never)).resolves.toMatchObject(
      { turns: [] }
    )
  })

  it("does not expose thrown Claude SDK diagnostics in public events", async () => {
    const adapter = new ClaudeAdapter()
    const events: ProviderRuntimeEvent[] = []
    const privateDiagnostic =
      "read C:\\private\\claude.json failed with token sk-sensitive"
    adapter.subscribe((event) => events.push(event))
    ;(
      adapter as unknown as {
        loadSdk(): Promise<unknown>
      }
    ).loadSdk = vi.fn(async () => ({
      query: () =>
        ({
          [Symbol.asyncIterator]() {
            return {
              next: () => Promise.reject(new Error(privateDiagnostic)),
            }
          },
        }),
    }))

    await adapter.sendTurn({
      threadId: "thread-private-error",
      message: "hello",
      modelId: "claude-opus-4-7",
      history: [],
    } as never)

    expect(JSON.stringify(events)).not.toContain(privateDiagnostic)
    expect(events.filter((event) => event.type === "runtime.error")).toEqual([
      expect.objectContaining({ message: "Claude provider failed." }),
    ])
    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "Claude provider failed.",
      }),
    ])
  })

  it("does not let a finished Claude turn clear its replacement query", async () => {
    const adapter = new ClaudeAdapter()
    const firstIteratorReturn = deferred<void>()
    const secondResult = deferred<void>()
    const firstTerminal = deferred<void>()
    let queryCall = 0
    adapter.subscribe((event) => {
      if (event.type === "turn.completed" && event.status === "failed") {
        firstTerminal.resolve()
      }
    })
    ;(
      adapter as unknown as {
        loadSdk(): Promise<unknown>
      }
    ).loadSdk = vi.fn(async () => ({
      query: () => {
        queryCall += 1
        if (queryCall === 1) {
          return (async function* () {
            try {
              yield {
                type: "result",
                subtype: "error",
                result: { error: "first turn failed" },
              }
            } finally {
              await firstIteratorReturn.promise
            }
          })()
        }
        return (async function* () {
          await secondResult.promise
          yield { type: "result", subtype: "success", result: {} }
        })()
      },
    }))

    const first = adapter.sendTurn({
      threadId: "thread-replacement",
      message: "first",
      modelId: "claude-opus-4-7",
      history: [],
    } as never)
    await firstTerminal.promise

    const second = adapter.sendTurn({
      threadId: "thread-replacement",
      message: "second",
      modelId: "claude-opus-4-7",
      history: [],
    } as never)
    await vi.waitFor(() => expect(queryCall).toBe(2))
    firstIteratorReturn.resolve()
    await first

    const context = (
      adapter as unknown as {
        sessions: Map<string, { query: unknown }>
      }
    ).sessions.get("thread-replacement")
    expect(context?.query).not.toBeNull()

    secondResult.resolve()
    await second
    expect(context?.query).toBeNull()
  })

  it("rejects before turn admission when the Claude SDK is unavailable", async () => {
    const adapter = new ClaudeAdapter()
    const events: ProviderRuntimeEvent[] = []
    adapter.subscribe((event) => events.push(event))
    ;(
      adapter as unknown as {
        loadSdk(): Promise<unknown>
      }
    ).loadSdk = vi.fn(async () => null)

    await expect(
      adapter.sendTurn({
        threadId: "thread-3",
        message: "hello",
        modelId: "claude-opus-4-7",
        history: [],
      } as never)
    ).rejects.toThrow("Claude SDK is not installed")
    expect(events.some((event) => event.type === "turn.started")).toBe(false)
  })

  it("keeps Claude output and completes the turn when cursor persistence fails", async () => {
    const adapter = new ClaudeAdapter({
      persistProviderThreadId: () => {
        throw new Error("settings database is temporarily locked")
      },
    })
    const events: ProviderRuntimeEvent[] = []
    adapter.subscribe((event) => events.push(event))
    ;(
      adapter as unknown as {
        loadSdk(): Promise<unknown>
      }
    ).loadSdk = vi.fn(async () => ({
      query: () =>
        (async function* () {
          yield {
            type: "assistant",
            session_id: "sdk-session-durable-output",
            uuid: "assistant-message-1",
            message: {
              content: [{ type: "text", text: "visible answer" }],
            },
          }
          yield { type: "result", subtype: "success", result: {} }
        })(),
    }))

    await expect(
      adapter.sendTurn({
        threadId: "thread-persistence-failure",
        message: "hello",
        modelId: "claude-opus-4-7",
        history: [],
      } as never)
    ).resolves.toBeUndefined()

    const contentIndex = events.findIndex(
      (event) => event.type === "content.replace" && event.text === "visible answer"
    )
    const warningIndex = events.findIndex(
      (event) =>
        event.type === "config.warning" &&
        event.payload.summary ===
          "Claude session continuation could not be saved"
    )
    expect(contentIndex).toBeGreaterThanOrEqual(0)
    expect(warningIndex).toBeGreaterThan(contentIndex)
    expect(events.filter((event) => event.type === "runtime.error")).toEqual([])
    expect(JSON.stringify(events)).not.toContain(
      "settings database is temporarily locked"
    )
    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      expect.objectContaining({ status: "completed" }),
    ])
    await expect(
      adapter.readThread("thread-persistence-failure" as never)
    ).resolves.toMatchObject({ turns: [{ id: expect.any(String) }] })
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
