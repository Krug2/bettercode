import type { WorkspaceContextSource } from "@betterc0de/schema"

export interface ContextSourceTreeNode {
  source: WorkspaceContextSource
  children: ContextSourceTreeNode[]
}

/**
 * Turns the context artifact's flat, parent-linked source list into a stable
 * forest for rendering.
 *
 * Backend IDs remain authoritative: the first occurrence of an ID wins,
 * children retain their original parentId, and malformed relationships
 * (missing parents, self-links, or cycles) are promoted to roots instead of
 * disappearing or creating an infinitely recursive renderer.
 */
export function buildContextSourceTree(
  sources: readonly WorkspaceContextSource[]
): ContextSourceTreeNode[] {
  const nodesById = new Map<string, ContextSourceTreeNode>()
  const orderedNodes: ContextSourceTreeNode[] = []

  for (const source of sources) {
    if (nodesById.has(source.id)) continue
    const node: ContextSourceTreeNode = { source, children: [] }
    nodesById.set(source.id, node)
    orderedNodes.push(node)
  }

  const roots: ContextSourceTreeNode[] = []
  for (const node of orderedNodes) {
    const parentId = node.source.parentId
    const parent = parentId ? nodesById.get(parentId) : undefined
    if (
      !parentId ||
      !parent ||
      parentId === node.source.id ||
      createsParentCycle(node.source.id, parentId, nodesById)
    ) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

  return roots
}

export function expandableContextSourceIds(
  roots: readonly ContextSourceTreeNode[]
): Set<string> {
  const ids = new Set<string>()
  const visit = (node: ContextSourceTreeNode) => {
    if (node.children.length > 0) ids.add(node.source.id)
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)
  return ids
}

function createsParentCycle(
  childId: string,
  parentId: string,
  nodesById: ReadonlyMap<string, ContextSourceTreeNode>
): boolean {
  const visited = new Set<string>()
  let currentId: string | null = parentId

  while (currentId) {
    if (currentId === childId || visited.has(currentId)) return true
    visited.add(currentId)
    currentId = nodesById.get(currentId)?.source.parentId ?? null
  }
  return false
}
