import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it } from "vitest"
import {
  closeTerminalPtySession,
  boundTerminalPtyData,
  openTerminalPtySession,
  readTerminalPtySession,
  resolveTerminalShellLaunch,
  TERMINAL_PTY_MAX_EVENT_DATA_BYTES,
} from "./terminalPty"

describe("terminalPty", () => {
  it("uses zsh as a login shell when selected", () => {
    if (process.platform === "win32") return

    expect(resolveTerminalShellLaunch("zsh")).toEqual({
      shell: "zsh",
      command: "zsh",
      args: ["-l"],
    })
  })

  it("accepts absolute unix shell paths for terminal sessions", () => {
    if (process.platform === "win32") return

    expect(resolveTerminalShellLaunch("/bin/sh")).toEqual({
      shell: "sh",
      command: "/bin/sh",
      args: [],
    })
  })

  it("redacts injected Claude system prompts from the visible launch event", async () => {
    const secretContext = "thread summary ".repeat(80)
    const opened = openTerminalPtySession({
      cwd: process.cwd(),
      command: process.execPath,
      args: ["-e", "process.exit(0)", "--append-system-prompt", secretContext],
      cols: 80,
      rows: 24,
    })

    const launch = opened.events.find((event) => event.type === "system")

    expect(opened.args).toContain("[BetterC0de thread context]")
    expect(opened.args).not.toContain(secretContext)
    expect(launch?.data).toContain("--append-system-prompt")
    expect(launch?.data).toContain("[BetterC0de thread context]")
    expect(launch?.data).not.toContain(secretContext.trim())

    // The child exits on its own. Wait for that exit before cleanup so the
    // Windows ConPTY implementation does not race a redundant process-tree
    // kill against an already disappearing console.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (readTerminalPtySession(opened.sessionId)?.status === "exited") break
      await delay(25)
    }
    closeTerminalPtySession(opened.sessionId)
  })

  it("opens a native PTY session and buffers process output", async () => {
    const opened = openTerminalPtySession({
      cwd: process.cwd(),
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello from pty\\n')"],
      cols: 80,
      rows: 24,
    })

    let cursor = opened.nextCursor
    let output = opened.events
      .filter((event) => event.type === "data")
      .map((event) => event.data ?? "")
      .join("")
    let status = opened.status

    for (let attempt = 0; attempt < 20 && status === "running"; attempt += 1) {
      await delay(50)
      const snapshot = readTerminalPtySession(opened.sessionId, cursor)
      expect(snapshot).not.toBeNull()
      if (!snapshot) break
      output += snapshot.events
        .filter((event) => event.type === "data")
        .map((event) => event.data ?? "")
        .join("")
      cursor = snapshot.nextCursor
      status = snapshot.status
    }

    closeTerminalPtySession(opened.sessionId)
    expect(output).toContain("hello from pty")
  })

  it("bounds a single PTY data event by UTF-8 bytes", () => {
    const huge = "🙂".repeat(3 * 1024 * 1024)
    const bounded = boundTerminalPtyData(huge)

    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(
      TERMINAL_PTY_MAX_EVENT_DATA_BYTES
    )
    expect(bounded).toContain("terminal output truncated")
  })
})
