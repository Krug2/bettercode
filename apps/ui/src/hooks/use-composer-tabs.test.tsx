import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { useComposerTabs } from "./use-composer-tabs"

describe("editor chat state initialization", () => {
  it("renders a valid selected tab before workspace history has loaded", () => {
    function Probe() {
      const state = useComposerTabs()
      const selected = state.composerTabs.find(
        (tab) => tab.id === state.activeComposerTab
      )
      return createElement(
        "span",
        { "data-split": state.splitMode },
        selected?.label ?? "Missing tab"
      )
    }
    const html = renderToStaticMarkup(createElement(Probe))
    expect(html).toContain('data-split="false"')
    expect(html).toContain("Chat 1")
    expect(html).not.toContain("Missing tab")
  })
})
