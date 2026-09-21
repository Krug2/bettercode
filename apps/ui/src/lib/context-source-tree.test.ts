import { describe, expect, it } from "vitest"
import type { WorkspaceContextSource } from "@betterc0de/schema"
import {
  buildContextSourceTree,
  expandableContextSourceIds,
} from "./context-source-tree"

function source(id: string, parentId: string | null): WorkspaceContextSource {
  return {
    id,
    parentId,
    kind: parentId ? "rule" : "rules",
    label: id,
    detail: null,
    sourcePath: null,
    estimatedTokens: 1,
    characters: 4,
    included: true,
    reason: "Included.",
    truncated: false,
  }
}

describe("buildContextSourceTree", () => {
  it("preserves source and sibling order while linking stable parent IDs", () => {
    const roots = buildContextSourceTree([
      source("rules", null),
      source("rule-a", "rules"),
      source("history", null),
      source("rule-b", "rules"),
      source("message", "history"),
      source("tool", "message"),
    ])

    expect(roots.map((node) => node.source.id)).toEqual(["rules", "history"])
    expect(roots[0]?.children.map((node) => node.source.id)).toEqual([
      "rule-a",
      "rule-b",
    ])
    expect(roots[1]?.children[0]?.children[0]?.source.id).toBe("tool")
    expect(roots[1]?.children[0]?.source.parentId).toBe("history")
    expect([...expandableContextSourceIds(roots)]).toEqual([
      "rules",
      "history",
      "message",
    ])
  })

  it("promotes missing, self-linked, and cyclic relationships to roots", () => {
    const roots = buildContextSourceTree([
      source("orphan", "missing"),
      source("self", "self"),
      source("cycle-a", "cycle-b"),
      source("cycle-b", "cycle-a"),
    ])

    expect(roots.map((node) => node.source.id)).toEqual([
      "orphan",
      "self",
      "cycle-a",
      "cycle-b",
    ])
    expect(roots.every((node) => node.children.length === 0)).toBe(true)
  })

  it("uses the first occurrence when a malformed payload repeats an ID", () => {
    const roots = buildContextSourceTree([
      source("rules", null),
      { ...source("rules", null), label: "duplicate" },
    ])

    expect(roots).toHaveLength(1)
    expect(roots[0]?.source.label).toBe("rules")
  })
})
