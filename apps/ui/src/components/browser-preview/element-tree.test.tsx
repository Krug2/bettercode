import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DomTreeNode } from "./dom-tree-node"
import { containsElement, elementName, filterElementTree } from "./element-tree"
import type { DomNode } from "./types"

function node(selector: string, children: DomNode[] = [], extra: Partial<DomNode> = {}): DomNode {
  return { tag: "div", id: "", classes: [], text: "", selector, children, ...extra }
}
const leaf = node("#skip", [], { tag: "a", text: "Skip to content", classes: ["skip-link"] })
const tree = node("body", [node(".wrapper", [node(".inner", [leaf])]), node("#other")], { tag: "body" })

describe("preview element tree", () => {
  it("keeps ancestors and original selectors while excluding unrelated branches", () => {
    for (const query of ["CONTENT", ".skip-link", "a"]) {
      const result = filterElementTree(tree, query)!
      expect(result.selector).toBe("body")
      expect(result.children).toHaveLength(1)
      expect(result.children[0].children[0].children[0]).toBe(leaf)
    }
    expect(filterElementTree(tree, "missing")).toBeNull()
    expect(filterElementTree(tree, "  ")).toBe(tree)
    expect(tree.children).toHaveLength(2)
  })

  it("uses readable text or IDs and still finds exact IDs and tag names", () => {
    const main = node("#dashboard", [], { tag: "main", id: "dashboard" })
    expect(elementName(leaf)).toBe("Skip to content")
    expect(elementName(main)).toBe("#dashboard")
    expect(filterElementTree(main, "#DASHBOARD")).toBe(main)
    expect(filterElementTree(main, "main")).toBe(main)
    expect(containsElement(tree, "#skip")).toBe(true)
    expect(containsElement(tree, null)).toBe(false)
  })

  it("reveals the selected descendant with accessible expansion and selection state", () => {
    const render = (selectedSelector: string | null) => renderToStaticMarkup(
      <DomTreeNode node={tree} depth={0} selectedSelector={selectedSelector} onSelect={() => {}} onHighlight={() => {}} />
    )
    expect(render(null)).not.toContain('data-element-selector="#skip"')
    const selected = render("#skip")
    expect(selected).toContain('data-element-selector="#skip"')
    expect(selected).toContain('aria-selected="true"')
    expect(selected).toContain('aria-label="a: Skip to content"')
    expect(selected).toContain('aria-level="4"')
    expect(selected).not.toContain('&lt;a')
  })
})
