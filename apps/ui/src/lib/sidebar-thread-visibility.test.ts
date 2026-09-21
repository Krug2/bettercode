import { describe, expect, it } from "vitest"
import { shouldShowThreadInSidebar } from "./sidebar-thread-visibility"

describe("shouldShowThreadInSidebar", () => {
  it("shows an intentionally-created project thread before its first prompt", () => {
    expect(
      shouldShowThreadInSidebar(
        {
          title: "New Chat",
          messages: [],
          messageCount: 0,
        },
        true
      )
    ).toBe(true)
  })

  it("hides unused automatic composer tabs", () => {
    expect(
      shouldShowThreadInSidebar(
        {
          title: "Chat 2",
          messages: [],
          messageCount: 0,
        },
        true
      )
    ).toBe(false)
    expect(
      shouldShowThreadInSidebar(
        {
          title: "Chat 2",
          messages: [],
          messageCount: 0,
        },
        false
      )
    ).toBe(false)
  })

  it("shows a composer thread as soon as it contains a conversation", () => {
    expect(
      shouldShowThreadInSidebar(
        {
          title: "Chat 2",
          messages: [{ role: "user" }],
        },
        true
      )
    ).toBe(true)
    expect(
      shouldShowThreadInSidebar(
        {
          title: "Chat 2",
          messages: [],
          messageCount: 2,
        },
        false
      )
    ).toBe(true)
  })
})
