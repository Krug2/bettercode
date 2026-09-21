import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import { Command } from "@/components/ui/command"
import { ChatSwitcherEntry } from "./chat-switcher-entry"

function render(
  overrides: Partial<Parameters<typeof ChatSwitcherEntry>[0]> = {}
) {
  return renderToStaticMarkup(
    createElement(
      Command,
      {},
      createElement(ChatSwitcherEntry, {
        label: "Improve checkout",
        onSelect() {},
        thread: {
          id: "a",
          title: "Improve checkout",
          createdAt: "2026-09-14T12:00:00Z",
          projectName: "Shop",
          projectPath: "C:/shop",
          branch: "feature/checkout",
          messages: [],
          messageCount: 12,
          lastModelId: "gpt-6-astra",
          updatedAt: "2026-09-14T12:00:00Z",
        } as ChatThread,
        ...overrides,
      })
    )
  )
}

describe("ChatSwitcherEntry", () => {
  it("shows the last model, project, branch and message count before hydration", () => {
    const html = render({ selectedModel: "claude-opus-4-6" })
    for (const detail of [
      "Last used model: GPT-6-Astra",
      "Shop",
      "feature/checkout",
      "12 messages",
    ])
      expect(html).toContain(detail)
    expect(html).not.toContain("claude-opus-4-6")
    expect(html).toContain('dateTime="2026-09-14T12:00:00Z"')
  })

  it("distinguishes the active chat, working state and close action", () => {
    const html = render({
      active: true,
      running: true,
      tabId: "tab-1",
      onClose() {},
    })
    expect(html).toContain('aria-current="true"')
    expect(html).toContain("Working")
    expect(html).toContain('aria-label="Close Improve checkout"')
    expect(html).not.toContain("12 messages")
    expect(html).not.toContain("animate-spin")
  })

  it("does not invent a model for an empty chat", () => {
    const html = render({ thread: undefined })
    expect(html).toContain("Model not recorded")
    expect(html).not.toContain("Last used model")
  })
})
