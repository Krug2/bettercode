import { describe, it, expect } from "vitest"
import {
  toolFailureText,
  runtimeFailurePresentation,
} from "./execution-diagnostics"

describe("execution diagnostics", () => {
  it("reads nested errors and exit codes without serializing unrelated fields", () => {
    expect(
      toolFailureText({
        error: { message: "Permission denied" },
        secret: "hidden",
      })
    ).toBe("Permission denied")
    expect(toolFailureText({ exit_code: 2 })).toBe(
      "Command exited with code 2."
    )
    expect(toolFailureText({ exit_code: 0, secret: "hidden" })).toBeUndefined()
    const circular: Record<string, unknown> = {}
    circular.error = circular
    expect(toolFailureText(circular)).toBeUndefined()
  })
  it("uses only public runtime metadata and reports retry status honestly", () => {
    const output = runtimeFailurePresentation({
      class: "transport_error",
      willRetry: true,
      message: "secret-token",
      error: "raw stack",
      event_id: "event-1",
    })
    expect(output.label).toBe("Connection to provider failed")
    expect(output.detail).toContain("retrying")
    expect(output.diagnostics).toContain("event-1")
    expect(JSON.stringify(output)).not.toMatch(/secret-token|raw stack/)
    expect(runtimeFailurePresentation({}).detail).not.toContain(
      "will not retry"
    )
  })
})
