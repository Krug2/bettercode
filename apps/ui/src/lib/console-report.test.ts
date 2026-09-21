import { describe, expect, it } from "vitest"
import { buildConsoleReport } from "./console-report"

const context = { activeThread: null, selectedModel: "test-model", messageCount: 0 }
describe("console report payload", () => {
  it("supports a report before a thread or error exists", () => {
    const report = buildConsoleReport({ ...context, consoleLogs: [] })
    expect(report.message).toContain("Thread: No thread")
    expect(report.message).toContain("Model: test-model")
    expect(report.message).toContain("Total: 0 (0 errors, 0 warnings)")
    expect(report.stack).toBe("")
  })

  it("includes session details, console messages and captured error stacks", () => {
    const report = buildConsoleReport({
      activeThread: { title: "Broken preview", projectPath: "C:\\project" },
      selectedModel: "test-model", messageCount: 3,
      consoleLogs: [
        { type: "error", message: "Failed to open", stack: "Error: Failed to open\n  at openProject", timestamp: new Date(0) },
        { type: "warn", message: "Try again", timestamp: new Date(0) },
      ],
    })
    expect(report.message).toContain("Thread: Broken preview")
    expect(report.message).toContain("Messages: 3")
    expect(report.message).toContain("2 (1 errors, 1 warnings)")
    expect(report.message).toContain("Try again")
    expect(report.stack).toContain("Error: Failed to open\n  at openProject")
  })

  it("bounds large reports while retaining an explicit truncation marker", () => {
    const report = buildConsoleReport({ ...context, consoleLogs: [{
      type: "error", message: "x".repeat(130_000), stack: "s".repeat(40_000), timestamp: new Date(0),
    }] })
    expect(report.message).toHaveLength(128_000)
    expect(report.stack).toHaveLength(32_000)
    expect(report.message).toMatch(/\[truncated\]$/)
    expect(report.stack).toMatch(/\[truncated\]$/)
  })
})
