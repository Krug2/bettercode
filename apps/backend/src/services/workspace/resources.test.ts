import { EventEmitter } from "node:events"
import type { ClientRequest, IncomingMessage } from "node:http"
import https from "node:https"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __setRemoteProjectFetchDependenciesForTests,
  listProjectInstructions,
} from "./resources"

vi.mock("./project-config", async (importOriginal) => ({
  ...await importOriginal<typeof import("./project-config")>(),
  betterC0deGlobalConfigDirectories: () => [],
  isBetterC0deClaudeCodePromptDisabled: () => true,
  isBetterC0deProjectConfigDisabled: () => true,
  readBetterC0deProjectConfigs: async () => [{
    config: { instructions: ["https://rules.example/rules.md"] },
  }],
}))

afterEach(() => {
  __setRemoteProjectFetchDependenciesForTests(null)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("remote instruction HTTP response handling", () => {
  it.each([204, 205, 304, 600])(
    "settles status %i without throwing from the HTTP event callback",
    async (statusCode) => {
      vi.useFakeTimers()
      __setRemoteProjectFetchDependenciesForTests({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      })
      const callbackFailures: unknown[] = []
      const requestSpy = vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1) as (response: IncomingMessage) => void
        const request = Object.assign(new EventEmitter(), {
          end: vi.fn(),
          destroy(error: Error) {
            request.emit("error", error)
            return request
          },
        })
        const response = Object.assign(new EventEmitter(), {
          statusCode,
          headers: {},
        }) as IncomingMessage
        queueMicrotask(() => {
          try {
            callback(response)
            response.emit("end")
          } catch (error) {
            // Capture the event-loop exception so the regression cannot crash
            // the test host, while still proving it never leaves the callback.
            callbackFailures.push(error)
            request.emit("error", error)
          }
        })
        return request as unknown as ClientRequest
      })

      const pending = listProjectInstructions(process.cwd())
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toEqual([])
      expect(requestSpy).toHaveBeenCalledOnce()
      expect(callbackFailures).toEqual([])
    }
  )
})
