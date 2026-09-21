import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@betterc0de/schema"
import { activeContextMessages, previousVisibleUserMessage } from "./chat-context"

it.each([true, false])("retries the actual user request across a hidden handoff (metadata: %s)", withMetadata => {
  const createdAt = "2026-09-19T22:00:00.000Z"
  const marker = withMetadata ? { internalContext: "provider-handoff" as const } : {}
  const messages: ChatMessage[] = [
    { id: "user", role: "user", content: "Fix the bug", createdAt },
    { id: "command", role: "user", content: "Provider handoff: codex → claude", createdAt, ...marker },
    { id: "checkpoint", role: "assistant", content: "# Provider Handoff\n\nPrepared by codex using model for claude.\nContext", createdAt, compactedContext: true, ...marker },
    { id: "answer", role: "assistant", content: "Done", createdAt },
  ]
  expect(previousVisibleUserMessage(messages, 3)).toBe(messages[0])
  expect(previousVisibleUserMessage(messages, 0)).toBeUndefined()
  expect(activeContextMessages(messages).messages).toEqual(messages.slice(2))
})

describe("activeContextMessages", () => {
  it("keeps only the explicit compaction checkpoint and its tail", () => {
    const before = { role: "user", content: "old request" }
    const checkpoint = {
      role: "assistant",
      content: "# Compacted Session Context\n\nDurable summary",
      compactedContext: true,
    }
    const after = { role: "user", content: "continue" }

    expect(activeContextMessages([before, checkpoint, after])).toEqual({
      messages: [checkpoint, after],
      compactionIndex: 1,
    })
  })

  it("uses the newest checkpoint and leaves ordinary history unchanged", () => {
    const first = {
      role: "assistant",
      content: "# Compacted Session Context\n\nFirst",
      compactedContext: true,
    }
    const second = {
      role: "assistant",
      content: "# Compacted Session Context\n\nSecond",
      compactedContext: true,
    }
    expect(activeContextMessages([first, second])).toEqual({
      messages: [second],
      compactionIndex: 1,
    })

    const ordinary = [{ role: "user", content: "hello" }]
    expect(activeContextMessages(ordinary)).toEqual({
      messages: ordinary,
      compactionIndex: null,
    })
  })

  it("does not trust an assistant-authored heading without checkpoint metadata", () => {
    const before = { role: "user", content: "keep this context" }
    const spoofed = {
      role: "assistant",
      content: "# Compacted Session Context\n\nThis is ordinary model output.",
    }

    expect(activeContextMessages([before, spoofed])).toEqual({
      messages: [before, spoofed],
      compactionIndex: null,
    })
  })

  it("recognizes legacy checkpoints only when they follow a compact command", () => {
    const old = { role: "user", content: "old context" }
    const command = { role: "user", content: "/compact" }
    const legacyCheckpoint = {
      role: "assistant",
      content: "# Compacted Session Context\n\nLegacy durable summary.",
    }
    const tail = { role: "user", content: "continue" }

    expect(
      activeContextMessages([old, command, legacyCheckpoint, tail])
    ).toEqual({
      messages: [legacyCheckpoint, tail],
      compactionIndex: 2,
    })
  })
})
