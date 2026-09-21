import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import { useChatStore } from "@/lib/chat-store"
import { ChatSwitcherMenu } from "./chat-switcher-menu"

vi.mock("@/lib/chat-store", async (original) => {
  const actual = await original<typeof import("@/lib/chat-store")>()
  const store = actual.useChatStore
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof store.getState>) => T) =>
        selector(store.getState()),
      store
    ),
  }
})

function thread(overrides: Partial<ChatThread> & { id: string }): ChatThread {
  return {
    title: "New Chat",
    projectName: "Shop",
    projectPath: "/repo/shop",
    messages: [],
    messageCount: 1,
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  } as ChatThread
}

function render(
  overrides: Partial<ComponentProps<typeof ChatSwitcherMenu>> = {}
): string {
  const props: ComponentProps<typeof ChatSwitcherMenu> = {
    composerTabs: [
      { id: "t1", threadId: "a", label: "Chat 1" },
      { id: "t2", threadId: "b", label: "Chat 2" },
    ],
    activeComposerTab: "t2",
    setActiveComposerTab: vi.fn(),
    closeComposerTab: vi.fn(),
    addComposerTab: vi.fn(),
    maxComposerTabs: 8,
    projectPath: "/repo/shop",
    ...overrides,
  }
  return renderToStaticMarkup(createElement(ChatSwitcherMenu, props))
}

describe("ChatSwitcherMenu", () => {
  beforeEach(() => {
    useChatStore.setState({
      threads: [
        thread({
          id: "a",
          messages: [{ role: "user", content: "Fix the header" }] as ChatThread["messages"],
        }),
        thread({ id: "b", title: "Checkout flow" }),
        thread({ id: "c", title: "Closed earlier" }),
      ],
    })
  })

  it("collapses the open chats into one trigger named after the active chat", () => {
    const html = render()
    expect(html).toContain("data-chat-switcher")
    expect(html).toContain('aria-label="Switch chat"')
    expect(html).toContain("Checkout flow")
    // Two open chats → count badge; the other chat is not spelled out in
    // the toolbar any more.
    expect(html).toMatch(/tabular-nums[^>]*>2</)
    expect(html).not.toContain("Fix the header")
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain("data-chat-tab-id")
    // New chat and the stack layout menu stay one click away.
    expect(html).toContain('aria-label="New chat"')
    expect(html).toContain('aria-label="Chat layout"')
  })

  it("falls back to the tab label when the active chat has no content yet", () => {
    const html = render({
      composerTabs: [{ id: "t9", threadId: null, label: "Chat 9" }],
      activeComposerTab: "t9",
    })
    expect(html).toContain("Chat 9")
    expect(html).not.toMatch(/tabular-nums[^>]*>1</)
  })

  it("disables the new-chat button at the tab cap", () => {
    const html = render({ maxComposerTabs: 2 })
    expect(html).toMatch(/aria-label="New chat"[^>]*disabled|disabled=""[^>]*aria-label="New chat"/)
  })
})
