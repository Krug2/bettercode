import { describe, expect, it } from "vitest"
import { buildToolCallTree, type ToolCallTreeInput } from "@/lib/tool-call-tree"

type Item = { name: string }

type ItemSpec = {
  kind: "tool" | "work"
  id: string
  order: number
  sortKey?: string
  correlation?: ToolCallTreeInput<Item, Item>["correlation"]
  label?: string
  workKind?: string
}

function item(value: ItemSpec): ToolCallTreeInput<Item, Item> {
  const base = {
    id: value.id,
    order: value.order,
    sortKey: value.sortKey ?? `2026-01-01T00:00:0${value.order}.000Z`,
    correlation: value.correlation ?? {},
    value: { name: value.id },
  }
  return value.kind === "work"
    ? {
        ...base,
        kind: "work",
        label: value.label ?? value.id,
        workKind: value.workKind ?? "task.progress",
      }
    : {
        ...base,
        kind: "tool",
      }
}

describe("buildToolCallTree", () => {
  it("keeps uncorrelated activity in deterministic chronological order", () => {
    const tree = buildToolCallTree([
      item({ kind: "tool", id: "later", order: 2 }),
      item({ kind: "work", id: "earlier", order: 1 }),
    ])

    expect(tree.map((node) => node.id)).toEqual(["work:earlier", "tool:later"])
  })

  it("builds agent, task, and nested tool relationships from canonical ids", () => {
    const tree = buildToolCallTree([
      item({
        kind: "work",
        id: "task-start",
        order: 1,
        label: "Inspect workspace",
        workKind: "task.started",
        correlation: {
          sessionId: "provider-session",
          agentId: "researcher",
          taskId: "inventory",
        },
      }),
      item({
        kind: "tool",
        id: "read",
        order: 2,
        correlation: {
          sessionId: "provider-session",
          agentId: "researcher",
          taskId: "inventory",
        },
      }),
      item({
        kind: "tool",
        id: "grep",
        order: 3,
        correlation: {
          sessionId: "provider-session",
          agentId: "researcher",
          taskId: "inventory",
          parentToolId: "read",
        },
      }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      id: "session:provider-session",
      children: [
        {
          id: "agent:researcher",
          children: [
            {
              id: "task:inventory",
              label: "Inspect workspace",
              children: [
                { id: "work:task-start" },
                {
                  id: "tool:read",
                  children: [{ id: "tool:grep" }],
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it("uses a provider session as the stable root without inventing tasks", () => {
    const tree = buildToolCallTree([
      item({
        kind: "tool",
        id: "read",
        order: 1,
        correlation: { sessionId: "session-1" },
      }),
      item({
        kind: "tool",
        id: "edit",
        order: 2,
        correlation: { sessionId: "session-1" },
      }),
    ])

    expect(tree).toMatchObject([
      {
        id: "session:session-1",
        children: [{ id: "tool:read" }, { id: "tool:edit" }],
      },
    ])
  })

  it("keeps missing tool parents visible as roots", () => {
    const tree = buildToolCallTree([
      item({
        kind: "tool",
        id: "child",
        order: 1,
        correlation: { parentToolId: "missing" },
      }),
    ])

    expect(tree.map((node) => node.id)).toEqual(["tool:child"])
  })

  it("breaks cyclic parent metadata instead of hiding nodes", () => {
    const tree = buildToolCallTree([
      item({
        kind: "tool",
        id: "one",
        order: 1,
        correlation: { parentToolId: "two" },
      }),
      item({
        kind: "tool",
        id: "two",
        order: 2,
        correlation: { parentToolId: "one" },
      }),
    ])

    const ids = JSON.stringify(tree)
    expect(ids).toContain("tool:one")
    expect(ids).toContain("tool:two")
  })
})
