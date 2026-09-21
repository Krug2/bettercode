import { EventEmitter } from "node:events"
import type http from "node:http"
import { describe, expect, it, vi } from "vitest"
import {
  closeHttpServer,
  runShutdownSteps,
  runWithShutdownDeadline,
  type ShutdownFailure,
} from "./shutdown"

describe("runWithShutdownDeadline", () => {
  it("rejects a stuck shutdown without exiting the embedding process", async () => {
    vi.useFakeTimers()
    try {
      let release: (() => void) | undefined
      const underlying = new Promise<void>((resolve) => {
        release = resolve
      })
      const onTimeout = vi.fn()
      const bounded = runWithShutdownDeadline(
        () => underlying,
        25,
        onTimeout
      )
      const rejection = expect(bounded).rejects.toMatchObject({
        name: "ShutdownTimeoutError",
        timeoutMs: 25,
      })

      await vi.advanceTimersByTimeAsync(25)

      await rejection
      expect(onTimeout).toHaveBeenCalledOnce()
      release?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears its deadline when shutdown completes", async () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn()

      await expect(
        runWithShutdownDeadline(async () => undefined, 25, onTimeout)
      ).resolves.toBeUndefined()

      await vi.advanceTimersByTimeAsync(25)
      expect(onTimeout).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("runShutdownSteps", () => {
  it("runs every cleanup step and reports failures only after cleanup", async () => {
    const calls: string[] = []
    const syncFailure = new Error("journal spool failed")
    const asyncFailure = new Error("hub close failed")
    const failures: ShutdownFailure[] = []

    const result = runShutdownSteps(
      [
        {
          name: "journal",
          run: () => {
            calls.push("journal")
            throw syncFailure
          },
        },
        {
          name: "database",
          run: async () => {
            calls.push("database")
          },
        },
        {
          name: "hub",
          run: async () => {
            calls.push("hub")
            throw asyncFailure
          },
        },
        {
          name: "timer",
          run: () => {
            calls.push("timer")
          },
        },
      ],
      (failure) => failures.push(failure)
    )

    await expect(result).rejects.toMatchObject({
      name: "AggregateError",
      errors: [syncFailure, asyncFailure],
    })
    expect(calls).toEqual(["journal", "database", "hub", "timer"])
    expect(failures).toEqual([
      { name: "journal", cause: syncFailure },
      { name: "hub", cause: asyncFailure },
    ])
  })

  it("resolves without reporting when all cleanup steps succeed", async () => {
    const onFailure = vi.fn()

    await expect(
      runShutdownSteps(
        [
          { name: "sync", run: () => undefined },
          { name: "async", run: async () => undefined },
        ],
        onFailure
      )
    ).resolves.toBeUndefined()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("continues cleanup when the failure reporter itself throws", async () => {
    const calls: string[] = []
    const stepFailure = new Error("step failed")
    const reporterFailure = new Error("logger failed")

    await expect(
      runShutdownSteps(
        [
          {
            name: "first",
            run: () => {
              calls.push("first")
              throw stepFailure
            },
          },
          {
            name: "second",
            run: () => {
              calls.push("second")
            },
          },
        ],
        () => {
          throw reporterFailure
        }
      )
    ).rejects.toMatchObject({
      name: "AggregateError",
      errors: [stepFailure, reporterFailure],
    })
    expect(calls).toEqual(["first", "second"])
  })
})

describe("closeHttpServer", () => {
  it("waits for the close callback after stopping idle connections", async () => {
    let closeCallback: ((error?: Error) => void) | undefined
    const server = Object.assign(new EventEmitter(), {
      listening: true,
      close: vi.fn((callback: (error?: Error) => void) => {
        closeCallback = callback
      }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    }) as unknown as http.Server

    const closing = closeHttpServer(server, 1_000)
    expect(server.close).toHaveBeenCalled()
    expect(server.closeIdleConnections).toHaveBeenCalled()

    closeCallback?.()
    await expect(closing).resolves.toBeUndefined()
    expect(server.closeAllConnections).not.toHaveBeenCalled()
  })

  it("force-closes and reports sockets that do not drain", async () => {
    vi.useFakeTimers()
    try {
      let closeCallback: ((error?: Error) => void) | undefined
      const server = Object.assign(new EventEmitter(), {
        listening: true,
        close: vi.fn((callback: (error?: Error) => void) => {
          closeCallback = callback
        }),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
      }) as unknown as http.Server

      const closing = closeHttpServer(server, 25)
      vi.advanceTimersByTime(25)

      expect(server.closeAllConnections).toHaveBeenCalled()
      closeCallback?.()
      await expect(closing).rejects.toThrow(/force-closed/i)
    } finally {
      vi.useRealTimers()
    }
  })
})
