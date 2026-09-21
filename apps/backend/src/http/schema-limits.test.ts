import { describe, expect, it } from "vitest"
import {
  chatGenerateThreadContextSummarySchema,
  chatSendSchema,
  gitCommitSchema,
  gitLogSchema,
  gitPathsSchema,
  shellRunSchema,
  terminalOpenSchema,
  terminalWriteSchema,
} from "./validation"

describe("backend request schema resource limits", () => {
  it("bounds shell argv, environment, session ids, and PTY writes", () => {
    expect(() =>
      shellRunSchema.parse({
        command: "x".repeat(16 * 1024 + 1),
        cwd: ".",
      })
    ).toThrow()
    expect(() =>
      shellRunSchema.parse({
        command: "echo ok",
        cwd: ".",
        env: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`SAFE_${index}`, "1"])
        ),
      })
    ).toThrow()
    expect(() =>
      terminalOpenSchema.parse({
        cwd: ".",
        command: "node",
        args: Array.from({ length: 129 }, () => "arg"),
      })
    ).toThrow()
    expect(() =>
      terminalWriteSchema.parse({
        sessionId: "x".repeat(257),
        data: "x",
      })
    ).toThrow()
    expect(() =>
      terminalWriteSchema.parse({
        sessionId: "pty-1",
        data: "x".repeat(64 * 1024 + 1),
      })
    ).toThrow()
  })

  it("bounds git argument arrays while allowing commit messages via stdin", () => {
    expect(() =>
      gitLogSchema.parse({ cwd: ".", count: 1_001 })
    ).toThrow()
    expect(() =>
      gitPathsSchema.parse({
        cwd: ".",
        paths: Array.from({ length: 1_001 }, (_, index) => `file-${index}`),
      })
    ).toThrow()
    expect(() =>
      gitPathsSchema.parse({ cwd: ".", paths: ["safe\0other"] })
    ).toThrow()
    expect(
      gitPathsSchema.parse({
        cwd: " repo with boundary spaces ",
        paths: [" leading.txt", "trailing.txt "],
      })
    ).toEqual({
      cwd: " repo with boundary spaces ",
      paths: [" leading.txt", "trailing.txt "],
    })
    expect(() =>
      gitPathsSchema.parse({ cwd: "   ", paths: [] })
    ).toThrow()
    expect(
      gitCommitSchema.parse({
        cwd: ".",
        message: "x".repeat(64 * 1024),
      }).message
    ).toHaveLength(64 * 1024)
  })

  it("bounds chat content, attachments, instructions, and generation transcripts", () => {
    const base = {
      threadId: "thread-1",
      message: "hello",
      modelId: "model-1",
    }
    expect(() =>
      chatSendSchema.parse({
        ...base,
        attachments: Array.from({ length: 33 }, (_, index) => ({
          type: "file",
          filename: `${index}.txt`,
          mediaType: "text/plain",
          url: "data:text/plain,ok",
        })),
      })
    ).toThrow()
    expect(() =>
      chatSendSchema.parse({
        ...base,
        systemInstruction: "x".repeat(256 * 1024 + 1),
      })
    ).toThrow()
    expect(() =>
      chatGenerateThreadContextSummarySchema.parse({
        transcript: "x".repeat(1024 * 1024 + 1),
      })
    ).toThrow()
  })
})
