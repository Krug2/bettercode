import { describe, expect, it } from "vitest"
import {
  appendBoundedProcessOutput,
  createBoundedProcessOutput,
  processOutputLimitError,
} from "./BoundedProcessOutput"

describe("bounded provider process output", () => {
  it("enforces one combined byte cap across stdout and stderr", () => {
    const output = createBoundedProcessOutput(8)

    expect(appendBoundedProcessOutput(output, "stdout", Buffer.from("12345")))
      .toBe(true)
    expect(appendBoundedProcessOutput(output, "stderr", Buffer.from("6789")))
      .toBe(false)

    expect(output).toMatchObject({
      stdout: "12345",
      stderr: "678",
      bufferedBytes: 8,
      byteCap: 8,
      limitExceeded: true,
    })
  })

  it("counts UTF-8 bytes rather than JavaScript characters", () => {
    const output = createBoundedProcessOutput(4)

    expect(appendBoundedProcessOutput(output, "stdout", "€€")).toBe(false)
    expect(output.bufferedBytes).toBe(4)
    expect(Buffer.byteLength(output.stdout, "utf8")).toBeLessThanOrEqual(6)
  })

  it("creates a structured limit error", () => {
    expect(processOutputLimitError("Claude probe", 1024)).toMatchObject({
      code: "PROVIDER_PROBE_OUTPUT_LIMIT_EXCEEDED",
      byteCap: 1024,
      message: "Claude probe exceeded the combined 1024-byte output limit.",
    })
  })
})
