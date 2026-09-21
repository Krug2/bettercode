import { describe, expect, it } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import {
  buildChatHistory,
  chatTabLabel,
  isPlaceholderTitle,
  orderOpenChats,
  threadHistoryTitle,
} from "./chat-switcher"

function thread(overrides: Partial<ChatThread> & { id: string }): ChatThread {
  return {
    title: "New Chat",
    projectName: "Shop",
    projectPath: "C:\\repo\\shop",
    messages: [],
    messageCount: 1,
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  } as ChatThread
}

describe("chatTabLabel", () => {
  it("prefers the first user message, then a real title, then the tab label", () => {
    const withMessage = thread({
      id: "a",
      messages: [
        { role: "assistant", content: "hi" },
        { role: "user", content: "  Build   the login page please, with tests  " },
      ] as ChatThread["messages"],
    })
    expect(chatTabLabel({ label: "Chat 1" }, withMessage)).toBe(
      "Build the login page please,…"
    )
    expect(chatTabLabel({ label: "Chat 1" }, withMessage, 200)).toBe(
      "Build the login page please, with tests"
    )
    expect(chatTabLabel({ label: "Chat 1" }, thread({ id: "b", title: "Checkout flow" }))).toBe(
      "Checkout flow"
    )
    expect(chatTabLabel({ label: "Chat 1" }, thread({ id: "c", title: "New Design" }))).toBe(
      "Chat 1"
    )
    expect(chatTabLabel({ label: "Chat 1" }, undefined)).toBe("Chat 1")
    expect(threadHistoryTitle(thread({ id: "d", title: "Chat 3" }))).toBe("Chat 3")
  })

  it("knows the app's placeholder titles", () => {
    for (const title of ["New Chat", "new design", "New Task", "Chat 12"]) {
      expect(isPlaceholderTitle(title), title).toBe(true)
    }
    expect(isPlaceholderTitle("Chat about tabs")).toBe(false)
  })
})

describe("buildChatHistory", () => {
  const threads = [
    thread({ id: "open", updatedAt: "2026-09-14T12:00:00.000Z" }),
    thread({ id: "old", updatedAt: "2026-09-13T12:00:00.000Z" }),
    thread({ id: "new", updatedAt: "2026-09-14T11:00:00.000Z" }),
    thread({ id: "empty", messageCount: 0, updatedAt: "2026-09-14T13:00:00.000Z" }),
    thread({
      id: "hydrated-only",
      messageCount: undefined,
      messages: [{ role: "user", content: "x" }] as ChatThread["messages"],
      updatedAt: "2026-09-14T09:00:00.000Z",
    }),
    thread({
      id: "other",
      projectName: "Blog",
      projectPath: "C:/repo/blog/",
      updatedAt: "2026-09-14T12:30:00.000Z",
    }),
  ]

  it("skips open tabs and untouched placeholders, splits by project, newest first", () => {
    const history = buildChatHistory({
      threads,
      openThreadIds: new Set(["open"]),
      projectPath: "c:/repo/shop",
    })
    expect(history.project.map((t) => t.id)).toEqual(["new", "hydrated-only", "old"])
    expect(history.elsewhere.map((t) => t.id)).toEqual(["other"])
  })

  it("puts everything in one bucket without a project and honours the limit", () => {
    const history = buildChatHistory({
      threads,
      openThreadIds: new Set(),
      projectPath: null,
      limit: 2,
    })
    expect(history.project).toEqual([])
    expect(history.elsewhere.map((t) => t.id)).toEqual(["other", "open"])
  })
})

describe("orderOpenChats", () => {
  // Tab order is the order chats were opened, which showed an untouched
  // first tab above the chat the user was in.
  it("lists the active chat first, then by activity, with empty tabs last", () => {
    const threads = new Map([
      ["old", thread({ id: "old", updatedAt: "2026-09-13T12:00:00.000Z" })],
      ["new", thread({ id: "new", updatedAt: "2026-09-14T12:00:00.000Z" })],
      ["cur", thread({ id: "cur", updatedAt: "2026-09-14T11:00:00.000Z" })],
      [
        "empty",
        thread({ id: "empty", messageCount: 0, updatedAt: "2026-09-14T13:00:00.000Z" }),
      ],
    ])
    const tabs = [
      { id: "t-empty", threadId: "empty" },
      { id: "t-old", threadId: "old" },
      { id: "t-new", threadId: "new" },
      { id: "t-cur", threadId: "cur" },
      { id: "t-none", threadId: null },
    ]
    expect(
      orderOpenChats(tabs, {
        activeTabId: "t-cur",
        threadById: (id) => (id ? threads.get(id) : undefined),
      }).map((tab) => tab.id)
    ).toEqual(["t-cur", "t-new", "t-old", "t-empty", "t-none"])
  })

  it("keeps the tab order when there is nothing to rank by", () => {
    const tabs = [
      { id: "a", threadId: null },
      { id: "b", threadId: null },
    ]
    expect(
      orderOpenChats(tabs, { activeTabId: null, threadById: () => undefined }).map(
        (tab) => tab.id
      )
    ).toEqual(["a", "b"])
  })
})
