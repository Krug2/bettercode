import { describe, expect, it } from "vitest"
import { buildSessionTree } from "@/lib/session-tree"

describe("buildSessionTree", () => {
  it("preserves input order while nesting forks", () => {
    const tree = buildSessionTree([
      { id: "root" },
      { id: "sibling" },
      { id: "child", parentThreadId: "root" },
      { id: "grandchild", parentThreadId: "child" },
    ])

    expect(tree).toMatchObject([
      {
        id: "root",
        children: [
          {
            id: "child",
            children: [{ id: "grandchild" }],
          },
        ],
      },
      { id: "sibling", children: [] },
    ])
  })

  it("keeps orphaned sessions visible at the root", () => {
    const tree = buildSessionTree([
      { id: "orphan", parentThreadId: "deleted-parent" },
    ])

    expect(tree.map((node) => node.id)).toEqual(["orphan"])
  })

  it("breaks self and multi-node cycles without losing sessions", () => {
    const tree = buildSessionTree([
      { id: "self", parentThreadId: "self" },
      { id: "one", parentThreadId: "two" },
      { id: "two", parentThreadId: "one" },
    ])

    expect(JSON.stringify(tree)).toContain('"id":"self"')
    expect(JSON.stringify(tree)).toContain('"id":"one"')
    expect(JSON.stringify(tree)).toContain('"id":"two"')
  })

  it("ignores duplicate replay records by stable session id", () => {
    const tree = buildSessionTree([
      { id: "session", title: "first" },
      { id: "session", title: "duplicate" },
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.value).toMatchObject({ title: "first" })
  })
})
