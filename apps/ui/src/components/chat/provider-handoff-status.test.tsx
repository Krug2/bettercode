import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProviderHandoffStatus, ProviderHandoffOverview } from "./provider-handoff-status"
import type { ProviderHandoffEntry } from "@/lib/provider-handoff"
import { ChatTranscript } from "./chat-transcript"
import { PROVIDER_HANDOFF_ACTIVITY } from "@betterc0de/schema"

const entry: ProviderHandoffEntry = { kind: "context-handoff", id: "handoff", createdAt: "2026-09-20T00:00:00Z", status: "compacting", sourceProvider: "claude", targetProvider: "grok_cli" }

describe("ProviderHandoffStatus", () => {
  it("uses human-readable model names and separates source from destination", () => {
    const html = renderToStaticMarkup(<ProviderHandoffOverview entry={{ ...entry, sourceProvider: "grok_cli", targetProvider: "claude", sourceModel: "grok-4.6", summary: "Keep the API stable." }} />)
    expect(html).toContain("Previous model")
    expect(html).toContain("Grok 4.6")
    expect(html).toContain("Next provider")
    expect(html).toContain("Claude")
    expect(html).not.toContain("grok-4.6")
    expect(html).not.toContain("Grok CLI")
    expect(html).toContain("icons/providers/grok.svg")
    expect(html).toContain("icons/providers/claude.svg")
    expect(html).toContain("dark:invert")
    expect(html).toContain("Keep the API stable.")
  })
  it("replaces the slow streaming placeholder in the actual chat transcript", () => {
    const html = renderToStaticMarkup(<ChatTranscript
      messages={[{ id: "request", role: "user", content: "Continue", createdAt: entry.createdAt }]}
      activities={[{ id: "progress", threadId: "thread", kind: PROVIDER_HANDOFF_ACTIVITY, tone: "info", summary: "", createdAt: entry.createdAt,
        payload: { status: "compacting", requestMessageId: "request", checkpointMessageId: "checkpoint", sourceProvider: "claude", targetProvider: "codex", sourceModel: "model" } }]}
      isStreaming minimalChat={false} activeThreadId="thread" handleSubmit={() => {}} setConfirmAction={() => {}} setPlanModalContent={() => {}}
      streamingText="" streamingPlanText="" streamingTools={[]} streamingDiffs={[]} streamingTasks={[]}
      reasoningText="" isReasoning={false} isPlanStreaming={false} chatMode="agent" shimmerPhase={4} selectedProvider={undefined}
    />)
    expect(html).toContain("Compacting previous context…")
    expect(html).not.toContain("Still working")
    expect(html.match(/data-agent-orb=/g)).toHaveLength(1)
  })

  it("uses an animated compaction status instead of the generic waiting label", () => {
    const html = renderToStaticMarkup(<ProviderHandoffStatus entry={entry} />)
    expect(html).toContain("Compacting previous context…")
    expect(html).toContain('data-agent-orb="solving"')
    expect(html).toContain("Claude → Grok · Compacting previous context…")
    expect(html).toContain("agent-activity-text")
    expect(html).not.toContain("Still working")
  })
  it("keeps the completed overview collapsed behind an accessible button", () => {
    const html = renderToStaticMarkup(<ProviderHandoffStatus entry={{ ...entry, status: "completed", summary: "Saved private context" }} />)
    expect(html).toContain("Context Compacted")
    expect(html).not.toContain("Claude CLI → Grok CLI")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("Saved private context")
    expect(html).not.toContain("data-agent-orb")
  })
  it.each(["failed", "interrupted"] as const)("does not leave a spinner after %s", status => {
    const html = renderToStaticMarkup(<ProviderHandoffStatus entry={{ ...entry, status }} />)
    expect(html).toContain(`Context handoff ${status}`)
    expect(html).toContain("Claude → Grok")
    expect(html).not.toContain("data-agent-orb")
  })
})
