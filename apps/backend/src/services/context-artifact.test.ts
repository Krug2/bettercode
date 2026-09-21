import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AppState } from "../appState"
import { buildWorkspaceContextArtifact } from "./context-artifact"

describe("buildWorkspaceContextArtifact", () => {
  const tempDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    )
  })

  it("returns token-aware rule, history, tool, attachment, and compaction sources", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "betterc0de-context-artifact-")
    )
    tempDirectories.push(workspaceRoot)
    await fs.writeFile(
      path.join(workspaceRoot, "AGENTS.md"),
      "Use the existing component library.\n",
      "utf8"
    )
    const messages = [
      {
        id: "old-user",
        role: "user",
        content: "Old context",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "summary",
        role: "assistant",
        content: "Compacted summary",
        compactedContext: true,
        compactionGeneration: 2,
        createdAt: "2026-01-01T00:01:00.000Z",
      },
      {
        id: "answer",
        role: "assistant",
        content: "Current answer",
        createdAt: "2026-01-01T00:02:00.000Z",
        systemInstructionCharacters: 800,
        usage: {
          usedTokens: 1_200,
          maxTokens: 4_000,
          compactsAutomatically: true,
        },
        toolCalls: [
          {
            id: "read-1",
            name: "Read",
            state: "output-available",
            input: { path: "src/app.ts" },
            output: "file contents",
          },
        ],
        attachments: [
          {
            id: "attachment-1",
            name: "design.png",
            type: "image/png",
            path: "assets/design.png",
          },
        ],
      },
    ]
    const state = {
      config: { dataDir: path.join(workspaceRoot, ".data") },
      settings: { get: () => ({ custom_rules: "" }) },
      threads: {
        listMessages: () => messages,
        buildProviderHistory: () => [
          { role: "assistant", content: "Compacted summary" },
          { role: "assistant", content: "Current answer" },
        ],
      },
    } as unknown as Pick<AppState, "config" | "settings" | "threads">

    const artifact = await buildWorkspaceContextArtifact(state, {
      workspaceRoot,
      targetPath: "src/app.ts",
      threadId: "thread-1",
      pendingMessageCharacters: 120,
      pendingAttachments: [
        {
          id: "draft-file",
          name: "notes.txt",
          mediaType: "text/plain",
          sizeBytes: 42,
        },
      ],
    })

    expect(artifact).toMatchObject({
      threadId: "thread-1",
      usedTokens: 1_200,
      maxTokens: 4_000,
      remainingTokens: 2_800,
      compactsAutomatically: true,
      compaction: {
        generation: 2,
        boundaryMessageId: "summary",
        excludedMessageCount: 1,
      },
    })
    expect(artifact.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "context:system",
          kind: "system",
          characters: 800,
          included: true,
        }),
        expect.objectContaining({
          id: "context:rules",
          kind: "rules",
          parentId: "context:system",
          included: true,
        }),
        expect.objectContaining({
          kind: "rule",
          sourcePath: "AGENTS.md",
          included: true,
        }),
        expect.objectContaining({
          id: "context:history",
          kind: "history",
          truncated: true,
        }),
        expect.objectContaining({
          id: "context:message:answer:tool:read-1",
          kind: "tool",
          sourcePath: "src/app.ts",
          included: true,
        }),
        expect.objectContaining({
          kind: "attachment",
          sourcePath: "assets/design.png",
          included: false,
        }),
        expect.objectContaining({
          id: "context:compaction",
          kind: "compaction",
        }),
        expect.objectContaining({
          id: "context:pending",
          kind: "prompt",
          characters: 120,
          included: true,
        }),
        expect.objectContaining({
          id: "context:pending:attachment:0",
          kind: "attachment",
          label: "notes.txt",
          included: true,
        }),
      ])
    )
  })

  it("returns inspectable empty roots when no thread is selected", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "betterc0de-context-empty-")
    )
    tempDirectories.push(workspaceRoot)
    const state = {
      config: { dataDir: path.join(workspaceRoot, ".data") },
      settings: { get: () => ({ custom_rules: "" }) },
      threads: {
        listMessages: () => [],
        buildProviderHistory: () => [],
      },
    } as unknown as Pick<AppState, "config" | "settings" | "threads">

    const artifact = await buildWorkspaceContextArtifact(state, {
      workspaceRoot,
      targetPath: ".",
    })

    expect(artifact.threadId).toBeNull()
    expect(artifact.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "context:system",
          kind: "system",
        }),
        expect.objectContaining({
          id: "context:rules",
          parentId: "context:system",
        }),
        expect.objectContaining({
          id: "context:history",
          included: false,
          estimatedTokens: 0,
        }),
        expect.objectContaining({
          id: "context:pending",
          included: false,
        }),
      ])
    )
  })
})
