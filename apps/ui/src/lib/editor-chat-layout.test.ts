import { describe, expect, it } from "vitest"
import { parseEditorChatLayout, usesComposerTabs } from "./editor-chat-layout"

describe("restoring editor chats", () => {
  it("restores distinct conversations and their selected layout", () => {
    const tabs = [
      { id: "a", threadId: "review", label: "Review" },
      { id: "b", threadId: "implement", label: "Implement" },
    ]
    expect(
      parseEditorChatLayout(
        JSON.stringify({
          version: 1,
          tabs,
          activeTabId: "b",
          splitTabIds: ["a", "b"],
        })
      )
    ).toEqual({ tabs, activeTabId: "b", splitTabIds: ["a", "b"] })
  })
  it("repairs stale selection and removes duplicate or missing panels", () => {
    const tabs = [
      { id: "a", threadId: "review", label: "Review" },
      { id: "b", threadId: "review", label: "Duplicate" },
    ]
    expect(
      parseEditorChatLayout(
        JSON.stringify({
          version: 1,
          tabs,
          activeTabId: "missing",
          splitTabIds: ["a", "a", "missing"],
        })
      )
    ).toEqual({ tabs: [tabs[0]], activeTabId: "a", splitTabIds: null })
  })
  it("ignores corrupted and unsupported saved data", () => {
    for (const value of [
      null,
      "broken",
      "null",
      '{"version":9,"tabs":[]}',
      '{"version":1,"tabs":[{}]}',
    ])
      expect(parseEditorChatLayout(value)).toBeNull()
  })
})

describe("usesComposerTabs", () => {
  // Editor and Design render the same chat container; guards that asked
  // "is this the editor?" left Design without persistence or thread sync.
  it("covers editor and design, not the agent pane grid", () => {
    expect(usesComposerTabs("editor")).toBe(true)
    expect(usesComposerTabs("design")).toBe(true)
    expect(usesComposerTabs("agent")).toBe(false)
  })
})
