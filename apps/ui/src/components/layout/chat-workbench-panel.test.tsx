import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ChatWorkbenchPanel } from "./chat-workbench-panel"

vi.mock("@/components/layout/chat-switcher-menu", () => ({
  ChatSwitcherMenu: (props: {
    composerTabs: Array<{ id: string }>
    projectPath?: string | null
  }) =>
    createElement("nav", {
      "data-tabs": props.composerTabs.length,
      "data-project": props.projectPath ?? "",
    }),
}))
vi.mock("@/components/chat/chat-toolbar", () => ({
  ChatToolbar: (props: { mode: string; gitStatusOnly?: boolean }) =>
    createElement("div", {
      "data-git-pill": props.mode,
      "data-git-only": props.gitStatusOnly ? "yes" : "no",
    }),
}))
vi.mock("@/components/layout/editor-chat-stack", () => ({
  EditorChatStack: (props: { activeTabIds: string[] }) =>
    createElement("div", { "data-stack": props.activeTabIds.join(",") }),
}))

function panel(
  overrides: Partial<ComponentProps<typeof ChatWorkbenchPanel>> = {}
): string {
  const props: ComponentProps<typeof ChatWorkbenchPanel> = {
    mode: "editor",
    minimalChat: true,
    activeThread: null,
    setConfirmAction: vi.fn(),
    tabs: {
      composerTabs: [{ id: "t1", threadId: "a" }],
      activeComposerTab: "t1",
    } as unknown as ComponentProps<typeof ChatWorkbenchPanel>["tabs"],
    activeTabIds: ["t1"],
    splitMode: false,
    insertIntoSplit: vi.fn(),
    renderColumn: (tabId) => createElement("section", { "data-column": tabId }),
    ...overrides,
  }
  return renderToStaticMarkup(createElement(ChatWorkbenchPanel, props))
}

describe("ChatWorkbenchPanel", () => {
  it("is the same container in editor and canvas mode: card, chat switcher, git pill, column", () => {
    const editor = panel({ mode: "editor" })
    const design = panel({ mode: "design", className: "relative", style: { width: 560 } })
    for (const html of [editor, design]) {
      expect(html).toContain("editor-chat-panel")
      expect(html).toContain("rounded-xl")
      expect(html).toContain("editor-chat-toolbar")
      expect(html).toContain('data-tabs="1"')
      expect(html).toContain('data-git-only="yes"')
      expect(html).toContain('data-column="t1"')
      expect(html).not.toContain("data-stack")
    }
    expect(editor).toContain('data-chat-workbench-panel="editor"')
    expect(design).toContain('data-chat-workbench-panel="design"')
    expect(design).toContain('data-git-pill="design"')
    expect(design).toContain("width:560px")
    // Only the frame differs between the two mounts.
    expect(editor.replace('data-chat-workbench-panel="editor"', "").replace('data-git-pill="editor"', "")).toBe(
      design
        .replace('data-chat-workbench-panel="design"', "")
        .replace('data-git-pill="design"', "")
        .replace(" relative", "")
        .replace(' style="width:560px"', "")
    )
  })

  it("stacks split tabs and renders children below the chat", () => {
    const html = panel({
      splitMode: true,
      activeTabIds: ["t1", "t2"],
      children: createElement("footer", { "data-console": "" }),
    })
    expect(html).toContain('data-stack="t1,t2"')
    expect(html).not.toContain('data-column="t1"')
    expect(html.indexOf("data-stack")).toBeLessThan(html.indexOf("data-console"))
  })
})
