import type { DomNode } from "./types"

export function elementName(node: Pick<DomNode, "tag" | "id" | "text" | "classes">): string {
  if (node.id) return `#${node.id}`
  if (node.text.trim()) return node.text.trim().replace(/\s+/g, " ")
  if (node.classes.length) return `.${node.classes[0]}`
  return ({ div: "Container", body: "Page", main: "Main content", nav: "Navigation" } as Record<string, string>)[node.tag] ?? node.tag
}

/** Keep ancestors so a search result never loses its place in the page. */
export function filterElementTree(node: DomNode, query: string): DomNode | null {
  const term = query.trim().toLowerCase()
  if (!term) return node
  if ([node.tag, node.id && `#${node.id}`, node.text, ...node.classes.map((name) => `.${name}`)]
    .some((value) => value.toLowerCase().includes(term))) return node
  const children = node.children.flatMap((child) => {
    const result = filterElementTree(child, term)
    return result ? [result] : []
  })
  return children.length ? { ...node, children } : null
}

export function containsElement(node: DomNode, selector: string | null): boolean {
  return selector !== null && (node.selector === selector || node.children.some((child) => containsElement(child, selector)))
}
