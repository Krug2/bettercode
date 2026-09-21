import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  makeEventNdjsonLogger,
  providerEventTraceEnabled,
} from "./EventNdjsonLogger"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-provider-log-"))
}

function findThreadLog(dir: string, readablePrefix: string): string {
  const matches = fs
    .readdirSync(dir)
    .filter((entry) =>
      new RegExp(`^${readablePrefix}-[a-f0-9]{16}\\.log$`).test(entry)
    )
  expect(matches).toHaveLength(1)
  return path.join(dir, matches[0]!)
}

function parseLogLine(line: string): {
  readonly observedAt: string
  readonly stream: string
  readonly payload: string
} {
  const match = /^\[([^\]]+)\] ([A-Z]+): (.+)$/.exec(line)
  if (!match) throw new Error(`invalid log line: ${line}`)
  return {
    observedAt: match[1] ?? "",
    stream: match[2] ?? "",
    payload: match[3] ?? "",
  }
}

describe("EventNdjsonLogger", () => {
  it("requires the dedicated provider-event trace opt-in", () => {
    expect(providerEventTraceEnabled({})).toBe(false)
    expect(
      providerEventTraceEnabled({
        backend_trace_provider_events: false,
      })
    ).toBe(false)
    expect(
      providerEventTraceEnabled({
        backend_trace_provider_events: true,
      })
    ).toBe(true)
  })

  it("suppresses future provider logs while conversation auto-save is disabled", async () => {
    const dir = tempDir()
    let enabled = false
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        { stream: "native", shouldWrite: () => enabled }
      )
      expect(eventLogger).toBeDefined()

      eventLogger?.write({ text: "must remain ephemeral" }, "thread-private")
      await eventLogger?.flush()
      expect(fs.readdirSync(dir).filter((entry) => entry.endsWith(".log"))).toEqual(
        []
      )

      enabled = true
      eventLogger?.write({ text: "allowed after enabling" }, "thread-private")
      await eventLogger?.flush()
      eventLogger?.close()

      const content = fs.readFileSync(
        findThreadLog(dir, "thread-private"),
        "utf8"
      )
      expect(content).toContain("allowed after enabling")
      expect(content).not.toContain("must remain ephemeral")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writes effect-style lines to thread-scoped files", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        { stream: "native" }
      )
      expect(eventLogger).toBeDefined()

      eventLogger?.write(
        { threadId: "provider-thread-1", id: "evt-1" },
        "thread-1"
      )
      eventLogger?.write(
        { type: "turn.completed", threadId: "provider-thread-2", id: "evt-2" },
        "thread-2"
      )
      await eventLogger?.flush()
      eventLogger?.close()

      const first = parseLogLine(
        fs.readFileSync(findThreadLog(dir, "thread-1"), "utf8").trim()
      )
      const second = parseLogLine(
        fs.readFileSync(findThreadLog(dir, "thread-2"), "utf8").trim()
      )

      expect(Number.isNaN(Date.parse(first.observedAt))).toBe(false)
      expect(first.stream).toBe("NTIVE")
      expect(first.payload).toBe(
        '{"threadId":"provider-thread-1","id":"evt-1"}'
      )
      expect(Number.isNaN(Date.parse(second.observedAt))).toBe(false)
      expect(second.stream).toBe("NTIVE")
      expect(second.payload).toBe(
        '{"type":"turn.completed","threadId":"provider-thread-2","id":"evt-2"}'
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("redacts sensitive fields and credential patterns before persisting", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        { stream: "native" }
      )
      eventLogger?.write(
        {
          apiKey: "top-secret",
          nested: {
            authorization: "Bearer abc.def.ghi",
            clientSecret: "camel-case-secret",
            refresh_token: "snake-case-token",
            token: "bare-session-secret",
            sessionToken: "session-token-secret",
          },
          output:
            "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz and Bearer xyz.123",
        },
        "thread-secret"
      )
      await eventLogger?.flush()
      eventLogger?.close()

      const content = fs.readFileSync(
        findThreadLog(dir, "thread-secret"),
        "utf8"
      )
      expect(content).not.toContain("top-secret")
      expect(content).not.toContain("abcdefghijklmnopqrstuvwxyz")
      expect(content).not.toContain("abc.def.ghi")
      expect(content).not.toContain("xyz.123")
      expect(content).not.toContain("camel-case-secret")
      expect(content).not.toContain("snake-case-token")
      expect(content).not.toContain("bare-session-secret")
      expect(content).not.toContain("session-token-secret")
      expect(content).toContain("[REDACTED]")
      if (process.platform !== "win32") {
        expect(fs.statSync(findThreadLog(dir, "thread-secret")).mode & 0o777).toBe(
          0o600
        )
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("uses the global segment only when the thread id is missing", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-canonical.ndjson"),
        { stream: "orchestration" }
      )
      expect(eventLogger).toBeDefined()

      eventLogger?.write({ id: "evt-no-thread" }, null)
      eventLogger?.write({ id: "evt-invalid-thread" }, "!!!")
      await eventLogger?.flush()
      eventLogger?.close()

      const lines = fs
        .readFileSync(path.join(dir, "_global.log"), "utf8")
        .trim()
        .split("\n")
        .map(parseLogLine)
      const invalidThreadLines = fs
        .readFileSync(findThreadLog(dir, "_thread"), "utf8")
        .trim()
        .split("\n")
        .map(parseLogLine)

      expect(lines).toHaveLength(1)
      expect(lines[0]?.stream).toBe("CANON")
      expect(lines[0]?.payload).toBe('{"id":"evt-no-thread"}')
      expect(invalidThreadLines).toHaveLength(1)
      expect(invalidThreadLines[0]?.stream).toBe("CANON")
      expect(invalidThreadLines[0]?.payload).toBe(
        '{"id":"evt-invalid-thread"}'
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps punctuation-only thread ids distinct from each other and global events", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        { stream: "native" }
      )

      eventLogger?.write({ id: "first" }, "!!!")
      eventLogger?.write({ id: "second" }, "???")
      eventLogger?.write({ id: "global" }, null)
      await eventLogger?.flush()

      expect(
        fs
          .readdirSync(dir)
          .filter((entry) => /^_thread-[a-f0-9]{16}\.log$/.test(entry))
      ).toHaveLength(2)
      expect(fs.existsSync(path.join(dir, "_global.log"))).toBe(true)

      await eventLogger?.removeThread("!!!")
      const remaining = fs
        .readdirSync(dir)
        .filter((entry) => /^_thread-[a-f0-9]{16}\.log$/.test(entry))
      expect(remaining).toHaveLength(1)
      expect(fs.readFileSync(path.join(dir, remaining[0]!), "utf8")).toContain(
        '"id":"second"'
      )
      expect(fs.readFileSync(path.join(dir, "_global.log"), "utf8")).toContain(
        '"id":"global"'
      )
      eventLogger?.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rotates per-thread files when max size is exceeded", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        {
          stream: "native",
          maxBytes: 120,
          maxFiles: 2,
        }
      )
      expect(eventLogger).toBeDefined()

      for (let index = 0; index < 10; index += 1) {
        eventLogger?.write(
          {
            threadId: "provider-thread-rotate",
            id: `evt-${index}`,
            payload: "x".repeat(40),
          },
          "thread-rotate"
        )
      }
      await eventLogger?.flush()
      eventLogger?.close()

      const fileStem = path.basename(findThreadLog(dir, "thread-rotate"))
      const files = fs
        .readdirSync(dir)
        .filter(
          (entry) => entry === fileStem || entry.startsWith(`${fileStem}.`)
        )
        .sort()

      expect(files.some((entry) => entry === `${fileStem}.1`)).toBe(true)
      expect(
        files.some((entry) => entry === fileStem || entry === `${fileStem}.2`)
      ).toBe(true)
      expect(files.some((entry) => entry === `${fileStem}.3`)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("removes a thread's active log and rotations after queued writes drain", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        { stream: "native", maxBytes: 80, maxFiles: 3 }
      )
      for (let index = 0; index < 8; index += 1) {
        eventLogger?.write(
          { id: index, payload: "x".repeat(40) },
          "thread-delete"
        )
      }
      eventLogger?.write({ id: "keep" }, "thread-keep")

      await eventLogger?.removeThread("thread-delete")
      await eventLogger?.flush()

      expect(
        fs
          .readdirSync(dir)
          .filter((entry) =>
            /^thread-delete-[a-f0-9]{16}\.log(?:\.\d+)?$/.test(entry)
          )
      ).toEqual([])
      expect(fs.existsSync(findThreadLog(dir, "thread-keep"))).toBe(true)
      eventLogger?.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("enforces a global provider-log directory budget", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        {
          stream: "native",
          maxBytes: 1_024,
          maxDirectoryBytes: 180,
        }
      )
      for (let index = 0; index < 6; index += 1) {
        eventLogger?.write(
          { id: index, payload: "x".repeat(60) },
          `thread-budget-${index}`
        )
      }
      await eventLogger?.flush()

      const totalBytes = fs
        .readdirSync(dir)
        .filter((entry) => entry.endsWith(".log"))
        .reduce(
          (total, entry) => total + fs.statSync(path.join(dir, entry)).size,
          0
        )
      expect(totalBytes).toBeLessThanOrEqual(180)
      eventLogger?.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("contains directory-budget failures and continues later writes", async () => {
    const dir = tempDir()
    const eventLogger = makeEventNdjsonLogger(path.join(dir, "native.ndjson"), { stream: "native" })!
    const readDirectory = vi.spyOn(fs.promises, "readdir")
      .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }))
    try {
      eventLogger.write({ id: "first" }, "thread-budget-error")
      await expect(eventLogger.flush()).resolves.toBeUndefined()
      eventLogger.write({ id: "second" }, "thread-budget-error")
      await expect(eventLogger.flush()).resolves.toBeUndefined()
      expect(fs.readFileSync(findThreadLog(dir, "thread-budget-error"), "utf8"))
        .toContain('"id":"second"')
    } finally {
      readDirectory.mockRestore()
      eventLogger.close()
      await eventLogger.flush()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps colliding readable prefixes isolated when one thread is removed", async () => {
    const dir = tempDir()
    try {
      const eventLogger = makeEventNdjsonLogger(
        path.join(dir, "provider-native.ndjson"),
        { stream: "native" }
      )

      eventLogger?.write({ id: "slash" }, "a/b")
      eventLogger?.write({ id: "dash" }, "a-b")
      await eventLogger?.flush()

      const hashedLogs = fs
        .readdirSync(dir)
        .filter((entry) => /^a-b-[a-f0-9]{16}\.log$/.test(entry))
      expect(hashedLogs).toHaveLength(2)
      expect(new Set(hashedLogs).size).toBe(2)

      const payloads = hashedLogs.map((entry) =>
        fs.readFileSync(path.join(dir, entry), "utf8")
      )
      expect(payloads.some((payload) => payload.includes('"id":"slash"'))).toBe(
        true
      )
      expect(payloads.some((payload) => payload.includes('"id":"dash"'))).toBe(
        true
      )

      const legacyCollidingPath = path.join(dir, "a-b.log")
      fs.writeFileSync(legacyCollidingPath, "legacy-collision\n", "utf8")

      await eventLogger?.removeThread("a/b")
      await eventLogger?.flush()

      const remainingHashedLogs = fs
        .readdirSync(dir)
        .filter((entry) => /^a-b-[a-f0-9]{16}\.log$/.test(entry))
      expect(remainingHashedLogs).toHaveLength(1)

      const remainingPayload = fs.readFileSync(
        path.join(dir, remainingHashedLogs[0]!),
        "utf8"
      )
      expect(remainingPayload).toContain('"id":"dash"')
      expect(remainingPayload).not.toContain('"id":"slash"')
      expect(fs.readFileSync(legacyCollidingPath, "utf8")).toBe(
        "legacy-collision\n"
      )
      eventLogger?.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
