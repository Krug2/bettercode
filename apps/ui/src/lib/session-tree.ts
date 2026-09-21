export type SessionTreeItem = {
  id: string
  parentThreadId?: string | null
}

export type SessionTreeNode<T extends SessionTreeItem> = {
  id: string
  value: T
  children: SessionTreeNode<T>[]
}

/**
 * Projects persisted fork metadata into a deterministic tree. An orphaned
 * parent, self-parent, or cycle is surfaced at the root rather than dropped,
 * which keeps older/corrupt session records navigable and replayable.
 */
export function buildSessionTree<T extends SessionTreeItem>(
  sessions: readonly T[]
): SessionTreeNode<T>[] {
  const nodes = new Map<string, SessionTreeNode<T>>()
  const order = new Map<string, number>()
  sessions.forEach((session, index) => {
    if (nodes.has(session.id)) return
    nodes.set(session.id, { id: session.id, value: session, children: [] })
    order.set(session.id, index)
  })

  const roots: SessionTreeNode<T>[] = []
  for (const node of nodes.values()) {
    const parentId = node.value.parentThreadId ?? undefined
    const parent =
      parentId &&
      parentId !== node.id &&
      !createsSessionCycle(node.id, parentId, nodes)
        ? nodes.get(parentId)
        : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  sortSessionNodes(roots, order)
  return roots
}

function createsSessionCycle<T extends SessionTreeItem>(
  nodeId: string,
  parentId: string,
  nodes: ReadonlyMap<string, SessionTreeNode<T>>
): boolean {
  const seen = new Set([nodeId])
  let current: string | undefined = parentId
  while (current) {
    if (seen.has(current)) return true
    seen.add(current)
    current = nodes.get(current)?.value.parentThreadId ?? undefined
  }
  return false
}

function sortSessionNodes<T extends SessionTreeItem>(
  nodes: SessionTreeNode<T>[],
  order: ReadonlyMap<string, number>
): void {
  nodes.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
  )
  for (const node of nodes) sortSessionNodes(node.children, order)
}
