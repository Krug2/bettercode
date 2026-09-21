import { describe, expect, it } from "vitest"
import {
  buildClaudeTerminalCompactionTranscript,
  buildClaudeTerminalSummaryPrompt,
  fingerprintClaudeTerminalCompaction,
  fingerprintClaudeTerminalLaunch,
  fingerprintClaudeTerminalTranscript,
} from "@/lib/claude-terminal-history"
import type { ChatMessage } from "@betterc0de/schema"

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    role: overrides.role ?? "user",
    content: overrides.content ?? "",
    createdAt: overrides.createdAt ?? "2026-05-14T12:00:00.000Z",
    ...overrides,
  }
}

describe("Claude Terminal compacted history handoff", () => {
  it("fingerprints compacted transcripts without storing raw history", () => {
    expect(fingerprintClaudeTerminalTranscript(null)).toBe("empty")
    expect(fingerprintClaudeTerminalTranscript("same transcript")).toBe(
      fingerprintClaudeTerminalTranscript("same transcript")
    )
    expect(fingerprintClaudeTerminalTranscript("same transcript")).not.toBe(
      fingerprintClaudeTerminalTranscript("different transcript")
    )
  })

  it("fingerprints launch and compaction settings separately", () => {
    const baseLaunch = {
      historyFingerprint: "v1:10:abcdef",
      selectedModel: "claude-opus-4-7",
      thinkingMode: "Max",
      permissionLevel: "bypass",
      compactionModelSelection: {
        instanceId: "claude",
        model: "claude-opus-4-7",
        options: [{ id: "effort", value: "max" }],
      },
    }

    expect(fingerprintClaudeTerminalLaunch(baseLaunch)).toBe(
      fingerprintClaudeTerminalLaunch({
        ...baseLaunch,
        compactionModelSelection: {
          instanceId: "claude",
          model: "claude-opus-4-7",
          options: [{ id: "effort", value: "max" }],
        },
      })
    )
    expect(fingerprintClaudeTerminalLaunch(baseLaunch)).not.toBe(
      fingerprintClaudeTerminalLaunch({
        ...baseLaunch,
        selectedModel: "claude-sonnet-4-6",
      })
    )
    expect(
      fingerprintClaudeTerminalCompaction({
        historyFingerprint: baseLaunch.historyFingerprint,
        modelSelection: baseLaunch.compactionModelSelection,
      })
    ).not.toBe(
      fingerprintClaudeTerminalCompaction({
        historyFingerprint: baseLaunch.historyFingerprint,
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5.4-mini",
        },
      })
    )
  })

  it("builds a transcript source for model compaction", () => {
    const transcript = buildClaudeTerminalCompactionTranscript({
      threadTitle: "Compaction",
      projectPath: "/repo",
      messages: [message({ role: "user", content: "Need Claude context" })],
    })

    expect(transcript).toContain("Thread metadata:")
    expect(transcript).toContain("Compact transcript:")
    expect(transcript).toContain("Need Claude context")
    expect(transcript).not.toContain(
      "Continue from the user's next terminal input"
    )
  })

  it("builds a larger model-compaction transcript for Claude Terminal handoff", () => {
    const messages = Array.from({ length: 50 }, (_, index) =>
      message({
        id: `m-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index} ${"x".repeat(900)}`,
      })
    )

    const transcript = buildClaudeTerminalCompactionTranscript({
      threadTitle: "Large compaction",
      projectPath: "/repo",
      messages,
    })

    expect(transcript).not.toBeNull()
    expect(transcript!.length).toBeLessThanOrEqual(60_000)
    expect(transcript).toContain("message 49")
    expect(transcript).not.toContain(
      "Continue from the user's next terminal input"
    )
  })

  it("wraps model summaries as Claude Terminal system context", () => {
    const prompt = buildClaudeTerminalSummaryPrompt({
      threadTitle: "Compaction",
      projectPath: "/repo",
      summary: "- Goal: preserve chat context\n- Next: start Claude",
    })

    expect(prompt).toContain("model-generated thread summary")
    expect(prompt).toContain("Model-compacted thread summary:")
    expect(prompt).toContain("- Next: start Claude")
  })

  it("keeps the compaction transcript bounded and omits older messages", () => {
    const messages = Array.from({ length: 100 }, (_, index) =>
      message({
        id: `m-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index} ${"x".repeat(1_000)}`,
      })
    )

    const transcript = buildClaudeTerminalCompactionTranscript({
      threadTitle: "Large thread",
      messages,
    })

    expect(transcript).not.toBeNull()
    expect(transcript!.length).toBeLessThanOrEqual(60_000)
    expect(transcript).toContain("Older messages omitted")
    expect(transcript).toContain("message 99")
    expect(transcript).not.toContain("message 0")
  })
})
