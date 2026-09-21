export type ToolCallTreeCorrelation = {
  sessionId?: string
  taskId?: string
  parentTaskId?: string
  agentId?: string
  parentAgentId?: string
  parentToolId?: string
}

export type ToolCallTreeInput<TTool, TWork> =
  | {
      kind: "tool"
      id: string
      sortKey: string
      order: number
      correlation: ToolCallTreeCorrelation
      value: TTool
    }
  | {
      kind: "work"
      id: string
      sortKey: string
      order: number
      correlation: ToolCallTreeCorrelation
      label: string
      workKind: string
      value: TWork
    }

export type ToolCallTreeNode<TTool, TWork> = {
  id: string
  kind: "session" | "agent" | "task" | "tool" | "work"
  label?: string
  sortKey: string
  order: number
  correlation: ToolCallTreeCorrelation
  value?: TTool | TWork
  children: ToolCallTreeNode<TTool, TWork>[]
}

type MutableNode<TTool, TWork> = Omit<
  ToolCallTreeNode<TTool, TWork>,
  "children"
> & {
  parentId?: string
  children: MutableNode<TTool, TWork>[]
}

/**
 * Builds the inspectable run tree without inventing provider relationships.
 * Correlated agent/task/tool ids become parent nodes; uncorrelated entries
 * stay as chronological roots. Missing parents and cyclic provider metadata
 * fail open as roots so a malformed event cannot hide run activity.
 */
export function buildToolCallTree<TTool, TWork>(
  input: readonly ToolCallTreeInput<TTool, TWork>[]
): ToolCallTreeNode<TTool, TWork>[] {
  const nodes = new Map<string, MutableNode<TTool, TWork>>()

  for (const entry of input) {
    const { correlation } = entry
    if (correlation.sessionId) {
      upsertVirtualNode(nodes, {
        id: sessionNodeId(correlation.sessionId),
        kind: "session",
        label: correlation.sessionId,
        sortKey: entry.sortKey,
        order: entry.order,
        correlation: { sessionId: correlation.sessionId },
      })
    }
    if (correlation.parentAgentId) {
      upsertVirtualNode(nodes, {
        id: agentNodeId(correlation.parentAgentId),
        kind: "agent",
        label: correlation.parentAgentId,
        sortKey: entry.sortKey,
        order: entry.order,
        correlation: {},
      })
    }
    if (correlation.agentId) {
      upsertVirtualNode(nodes, {
        id: agentNodeId(correlation.agentId),
        kind: "agent",
        label: correlation.agentId,
        sortKey: entry.sortKey,
        order: entry.order,
        correlation,
        parentId: correlation.parentAgentId
          ? agentNodeId(correlation.parentAgentId)
          : correlation.sessionId
            ? sessionNodeId(correlation.sessionId)
            : undefined,
      })
    }
    if (correlation.parentTaskId) {
      upsertVirtualNode(nodes, {
        id: taskNodeId(correlation.parentTaskId),
        kind: "task",
        label: correlation.parentTaskId,
        sortKey: entry.sortKey,
        order: entry.order,
        correlation: {},
      })
    }
    if (correlation.taskId) {
      upsertVirtualNode(nodes, {
        id: taskNodeId(correlation.taskId),
        kind: "task",
        label:
          entry.kind === "work" && entry.workKind === "task.started"
            ? entry.label
            : correlation.taskId,
        sortKey: entry.sortKey,
        order: entry.order,
        correlation,
        parentId: correlation.parentTaskId
          ? taskNodeId(correlation.parentTaskId)
          : correlation.agentId
            ? agentNodeId(correlation.agentId)
            : correlation.sessionId
              ? sessionNodeId(correlation.sessionId)
              : undefined,
      })
    }
  }

  for (const entry of input) {
    const nodeId =
      entry.kind === "tool" ? toolNodeId(entry.id) : workNodeId(entry.id)
    const parentId = resolveEntryParent(entry.correlation, nodes)
    nodes.set(nodeId, {
      id: nodeId,
      kind: entry.kind,
      ...(entry.kind === "work" ? { label: entry.label } : {}),
      sortKey: entry.sortKey,
      order: entry.order,
      correlation: entry.correlation,
      value: entry.value,
      parentId,
      children: [],
    })
  }

  const roots: MutableNode<TTool, TWork>[] = []
  for (const node of nodes.values()) {
    const parent =
      node.parentId && !wouldCreateCycle(node.id, node.parentId, nodes)
        ? nodes.get(node.parentId)
        : undefined
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }

  sortTree(roots)
  return roots
}

function upsertVirtualNode<TTool, TWork>(
  nodes: Map<string, MutableNode<TTool, TWork>>,
  next: Omit<MutableNode<TTool, TWork>, "children" | "value">
): void {
  const current = nodes.get(next.id)
  if (!current) {
    nodes.set(next.id, { ...next, children: [] })
    return
  }
  const nextIsEarlier = compareNodes(next, current) < 0
  current.sortKey = nextIsEarlier ? next.sortKey : current.sortKey
  current.order = Math.min(current.order, next.order)
  if (
    next.label &&
    (current.label === undefined ||
      current.label === current.correlation.agentId ||
      current.label === current.correlation.taskId)
  ) {
    current.label = next.label
  }
  current.correlation = {
    ...current.correlation,
    ...definedCorrelation(next.correlation),
  }
  current.parentId ??= next.parentId
}

function definedCorrelation(
  value: ToolCallTreeCorrelation
): ToolCallTreeCorrelation {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as ToolCallTreeCorrelation
}

function resolveEntryParent<TTool, TWork>(
  correlation: ToolCallTreeCorrelation,
  nodes: ReadonlyMap<string, MutableNode<TTool, TWork>>
): string | undefined {
  if (correlation.parentToolId) {
    const id = toolNodeId(correlation.parentToolId)
    if (nodes.has(id)) return id
  }
  if (correlation.taskId) {
    const id = taskNodeId(correlation.taskId)
    if (nodes.has(id)) return id
  }
  if (correlation.agentId) {
    const id = agentNodeId(correlation.agentId)
    if (nodes.has(id)) return id
  }
  if (correlation.sessionId) {
    const id = sessionNodeId(correlation.sessionId)
    if (nodes.has(id)) return id
  }
  return undefined
}

function wouldCreateCycle<TTool, TWork>(
  nodeId: string,
  parentId: string,
  nodes: ReadonlyMap<string, MutableNode<TTool, TWork>>
): boolean {
  const seen = new Set([nodeId])
  let current: string | undefined = parentId
  while (current) {
    if (seen.has(current)) return true
    seen.add(current)
    current = nodes.get(current)?.parentId
  }
  return false
}

function sortTree<TTool, TWork>(nodes: MutableNode<TTool, TWork>[]): void {
  nodes.sort(compareNodes)
  for (const node of nodes) sortTree(node.children)
}

function compareNodes(
  a: Pick<MutableNode<unknown, unknown>, "sortKey" | "order" | "id">,
  b: Pick<MutableNode<unknown, unknown>, "sortKey" | "order" | "id">
): number {
  if (a.sortKey && b.sortKey && a.sortKey !== b.sortKey) {
    return a.sortKey.localeCompare(b.sortKey)
  }
  if (a.order !== b.order) return a.order - b.order
  return a.id.localeCompare(b.id)
}

function agentNodeId(id: string): string {
  return `agent:${id}`
}

function sessionNodeId(id: string): string {
  return `session:${id}`
}

function taskNodeId(id: string): string {
  return `task:${id}`
}

function toolNodeId(id: string): string {
  return `tool:${id}`
}

function workNodeId(id: string): string {
  return `work:${id}`
}
