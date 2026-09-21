import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChatStore } from "@/lib/chat-store"
import { EmptyStateHero, resolveStartSurface } from "./empty-state-hero"

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

describe("resolveStartSurface", () => {
  it("offers design work in canvas mode and code work everywhere else", () => {
    const design = resolveStartSurface("design", "Shop")
    expect(design.headline).toBe("What should we design")
    expect(design.projectSuffix).toBe("Shop")
    expect(design.suggestions.map((s) => s.label)).toEqual([
      "Build a landing page",
      "Design a screen or flow",
      "Polish what's in the preview",
      "Build a component",
    ])
    expect(design.suggestions.every((s) => s.prompt.length > 0)).toBe(true)

    const agent = resolveStartSurface("agent", "  ")
    expect(agent.headline).toBe("What should we build")
    expect(agent.projectSuffix).toBeNull()
    expect(agent.suggestions.map((s) => s.label)).toContain("Find and fix a bug")
    expect(resolveStartSurface("editor", null).suggestions).toBe(agent.suggestions)
  })
})

describe("EmptyStateHero", () => {
  beforeEach(() => {
    useChatStore.setState({
      threads: [
        {
          id: "t1",
          projectName: "Shop",
        } as unknown as ReturnType<typeof useChatStore.getState>["threads"][number],
      ],
    })
  })

  it("lays the cards out by container width, never by viewport width", () => {
    const html = renderToStaticMarkup(<EmptyStateHero variant="design" threadId="t1" />)
    expect(html).toContain('data-start-surface="design"')
    expect(html).toContain("@container")
    expect(html).toContain("@min-[520px]:grid-cols-2")
    expect(html).not.toContain("sm:grid-cols-2")
    expect(html).not.toContain("md:grid-cols-2")
  })

  it("shows design starting points in canvas mode and none of the code ones", () => {
    const html = renderToStaticMarkup(<EmptyStateHero variant="design" threadId="t1" />)
    expect(html).toContain("What should we design")
    expect(html).toContain("Shop")
    expect(html).toContain("Build a landing page")
    expect(html).toContain("Polish what")
    expect(html).not.toContain("Explore and understand code")
    expect(html).not.toContain("Find and fix a bug")
    expect(html.match(/<button/g)).toHaveLength(4)
  })

  it("keeps the code starting points in agent mode", () => {
    const html = renderToStaticMarkup(<EmptyStateHero variant="agent" threadId="t1" />)
    expect(html).toContain("What should we build")
    expect(html).toContain("Explore and understand code")
    expect(html).not.toContain("Build a landing page")
  })

  it("renders the compact chip row for the editor side panel", () => {
    const html = renderToStaticMarkup(<EmptyStateHero variant="editor" threadId="t1" />)
    expect(html).toContain("Work with your code")
    expect(html).not.toContain("@container")
    expect(html.match(/<button/g)).toHaveLength(2)
  })
})
