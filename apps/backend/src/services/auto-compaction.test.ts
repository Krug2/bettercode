import { describe, expect, it } from "vitest"
import {
  autoCompactionContextSnapshot,
  buildAutoCompactionTranscript,
  decideAutoCompaction,
  estimateIncomingTokens,
  resolveAutoCompactionConfig,
} from "./auto-compaction"

const defaultConfig = resolveAutoCompactionConfig([])

describe("automatic context compaction policy", () => {
  it("uses bounded defaults and triggers at the reserved-token boundary", () => {
    const decision = decideAutoCompaction({
      config: defaultConfig,
      usedTokens: 179_000,
      estimatedTokens: 12_000,
      incomingTokens: 1_000,
      maxTokens: 200_000,
      completedTurns: 3,
      compactionGeneration: 1,
    })

    expect(decision).toMatchObject({
      shouldCompact: true,
      reason: "threshold-reached",
      thresholdTokens: 180_000,
      reservedTokens: 20_000,
      preserveRecentTokens: 8_000,
      tailTurns: 2,
      projectedTokens: 180_000,
      compactionGeneration: 1,
    })
  })

  it("honors ordered config overrides, including the final disable flag", () => {
    const config = resolveAutoCompactionConfig([
      {
        key: "compaction.auto",
        value: "enabled",
        sourcePath: "project.json#compaction.auto",
      },
      {
        key: "compaction.reserved",
        value: "2,000",
        sourcePath: "project.json#compaction.reserved",
      },
      {
        key: "compaction.preserve_recent_tokens",
        value: "12000",
        sourcePath: "project.json#compaction.preserve_recent_tokens",
      },
      {
        key: "compaction.tail_turns",
        value: "3",
        sourcePath: "project.json#compaction.tail_turns",
      },
      {
        key: "compaction.auto",
        value: "disabled",
        sourcePath: "environment#compaction.auto",
      },
    ])

    expect(config).toEqual({
      enabled: false,
      reservedTokens: 2_000,
      preserveRecentTokens: 12_000,
      tailTurns: 3,
      sources: {
        enabled: "environment#compaction.auto",
        reservedTokens: "project.json#compaction.reserved",
        preserveRecentTokens: "project.json#compaction.preserve_recent_tokens",
        tailTurns: "project.json#compaction.tail_turns",
      },
    })
    expect(
      decideAutoCompaction({
        config,
        usedTokens: 199_000,
        estimatedTokens: 1,
        incomingTokens: 1_000,
        maxTokens: 200_000,
        completedTurns: 10,
      })
    ).toMatchObject({ shouldCompact: false, reason: "disabled" })
  })

  it("defers to provider-native compaction and never races an active turn", () => {
    expect(
      decideAutoCompaction({
        config: defaultConfig,
        compactsAutomatically: true,
        usedTokens: 190_000,
        estimatedTokens: 20_000,
        incomingTokens: 1_000,
        maxTokens: 200_000,
        completedTurns: 5,
      })
    ).toMatchObject({ shouldCompact: false, reason: "provider-native" })

    expect(
      decideAutoCompaction({
        config: defaultConfig,
        turnActive: true,
        usedTokens: 190_000,
        estimatedTokens: 20_000,
        incomingTokens: 1_000,
        maxTokens: 200_000,
        completedTurns: 5,
      })
    ).toMatchObject({ shouldCompact: false, reason: "turn-active" })
  })

  it("does not compact below threshold or without reclaimable history", () => {
    expect(
      decideAutoCompaction({
        config: defaultConfig,
        usedTokens: 100_000,
        estimatedTokens: 20_000,
        incomingTokens: 1_000,
        maxTokens: 200_000,
        completedTurns: 10,
      })
    ).toMatchObject({ shouldCompact: false, reason: "below-threshold" })

    expect(
      decideAutoCompaction({
        config: defaultConfig,
        usedTokens: 190_000,
        estimatedTokens: 20_000,
        incomingTokens: 1_000,
        maxTokens: 200_000,
        completedTurns: 2,
      })
    ).toMatchObject({
      shouldCompact: false,
      reason: "insufficient-history",
    })
  })

  it("fails closed when config or the model budget is unavailable", () => {
    expect(
      decideAutoCompaction({
        config: defaultConfig,
        configAvailable: false,
        estimatedTokens: 20_000,
        incomingTokens: 1_000,
        maxTokens: 200_000,
        completedTurns: 10,
      })
    ).toMatchObject({ shouldCompact: false, reason: "config-unavailable" })

    expect(
      decideAutoCompaction({
        config: defaultConfig,
        estimatedTokens: 20_000,
        incomingTokens: 1_000,
        completedTurns: 10,
      })
    ).toMatchObject({
      shouldCompact: false,
      reason: "context-window-unknown",
    })
  })

  it("uses an explicit input limit and configured reserve", () => {
    const config = resolveAutoCompactionConfig([
      { key: "compaction.reserved", value: "4000" },
      { key: "compaction.tail_turns", value: "0" },
    ])
    expect(
      decideAutoCompaction({
        config,
        usedTokens: 95_500,
        estimatedTokens: 10_000,
        incomingTokens: 500,
        maxTokens: 200_000,
        modelInputTokens: 100_000,
        modelOutputTokens: 16_000,
        completedTurns: 1,
      })
    ).toMatchObject({
      shouldCompact: true,
      thresholdTokens: 96_000,
      reservedTokens: 4_000,
    })
  })
})

describe("automatic context compaction snapshot", () => {
  it("estimates only the active durable context and counts completed turns", () => {
    const snapshot = autoCompactionContextSnapshot([
      {
        role: "user",
        content: "obsolete".repeat(10_000),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "# Compacted Session Context\n\nsummary",
        compactedContext: true,
        compactionGeneration: 4,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      { role: "user", content: "next" },
      {
        role: "assistant",
        content: "done",
        toolCalls: [{ id: "tool-1", output: "result" }],
      },
      { role: "user", content: "pending" },
    ])

    expect(snapshot).toMatchObject({
      completedTurns: 1,
      compactionGeneration: 4,
      boundaryCreatedAt: "2026-01-02T00:00:00.000Z",
    })
    expect(snapshot.estimatedTokens).toBeLessThan(100)
  })

  it("recognizes legacy compact command/checkpoint pairs", () => {
    const snapshot = autoCompactionContextSnapshot([
      { role: "user", content: "old".repeat(10_000) },
      { role: "user", content: "/compact --automatic" },
      {
        role: "assistant",
        content: "# Compacted Session Context\n\nsummary",
      },
    ])
    expect(snapshot.estimatedTokens).toBeLessThan(100)
    expect(snapshot.completedTurns).toBe(0)
  })

  it("uses a deterministic character estimator for the incoming turn", () => {
    expect(estimateIncomingTokens("12345")).toBe(2)
  })

  it("excludes an optimistically persisted incoming dispatch", () => {
    const snapshot = autoCompactionContextSnapshot(
      [
        { id: "old-user", role: "user", content: "old question" },
        { id: "old-assistant", role: "assistant", content: "old answer" },
        {
          id: "incoming",
          role: "user",
          content: "x".repeat(40_000),
        },
      ],
      { excludeMessageId: "incoming" }
    )

    expect(snapshot.completedTurns).toBe(1)
    expect(snapshot.lastMessageId).toBe("old-assistant")
    expect(snapshot.estimatedTokens).toBeLessThan(100)
  })
})

describe("automatic context compaction transcript", () => {
  it("uses only durable active context and excludes the incoming dispatch", () => {
    const transcript = buildAutoCompactionTranscript({
      threadTitle: "Server compaction",
      projectPath: "C:/workspace",
      excludeMessageId: "incoming",
      messages: [
        {
          id: "obsolete",
          role: "user",
          content: "obsolete secret".repeat(1_000),
        },
        {
          id: "checkpoint",
          role: "assistant",
          content: "# Compacted Session Context\n\nprior summary",
          compactedContext: true,
          compactionGeneration: 2,
        },
        {
          id: "useful",
          role: "user",
          content: "preserve this requirement",
          diffs: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
        },
        {
          id: "failed",
          role: "assistant",
          content: "do not preserve",
          dispatchStatus: "failed",
        },
        {
          id: "incoming",
          role: "user",
          content: "current prompt is dispatched separately",
        },
      ],
    })

    expect(transcript).toContain("prior summary")
    expect(transcript).toContain("preserve this requirement")
    expect(transcript).toContain("src/app.ts (+2/-1)")
    expect(transcript).not.toContain("obsolete secret")
    expect(transcript).not.toContain("do not preserve")
    expect(transcript).not.toContain("current prompt is dispatched separately")
  })

  it("bounds oversized message payloads and the final transcript", () => {
    const transcript = buildAutoCompactionTranscript({
      messages: Array.from({ length: 120 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `${index}:${"x".repeat(10_000)}`,
        toolCalls: Array.from({ length: 30 }, (__, toolIndex) => ({
          id: `tool-${index}-${toolIndex}`,
          output: "y".repeat(2_000),
        })),
      })),
    })

    expect(transcript).not.toBeNull()
    expect(transcript!.length).toBeLessThanOrEqual(60_000)
    expect(transcript).toContain("Older messages omitted")
    expect(transcript).toContain("[truncated]")
  })
})
