import { describe, expect, it } from "vitest"
import {
  MIN_FOLDED_RUN_LENGTH,
  foldRepeatedToolRuns,
  foldedRunLabel,
} from "@/lib/tool-run-folding"

interface Row {
  id: string
  signature: string
  detail?: string
  hasChildren?: boolean
}

function fold(rows: Row[], minRunLength?: number) {
  return foldRepeatedToolRuns(
    rows,
    (row) => ({
      id: row.id,
      kind: "tool",
      signature: row.signature,
      ...(row.detail !== undefined ? { detail: row.detail } : {}),
      hasChildren: row.hasChildren ?? false,
    }),
    minRunLength
  )
}

function shape(rows: Row[], minRunLength?: number) {
  return fold(rows, minRunLength).map((entry) =>
    entry.type === "run"
      ? `run(${entry.signature}×${entry.nodes.length})`
      : `single(${entry.node.id})`
  )
}

describe("foldRepeatedToolRuns", () => {
  it("folds a run of identical rows", () => {
    const rows = Array.from({ length: 16 }, (_, index) => ({
      id: `t${index}`,
      signature: "Ran command",
    }))
    expect(shape(rows)).toEqual(["run(Ran command×16)"])
  })

  it("leaves short runs expanded", () => {
    expect(MIN_FOLDED_RUN_LENGTH).toBe(3)
    expect(
      shape([
        { id: "a", signature: "Read file" },
        { id: "b", signature: "Read file" },
      ])
    ).toEqual(["single(a)", "single(b)"])
  })

  // Reordering to group non-adjacent calls would misrepresent the run.
  it("only folds adjacent rows", () => {
    expect(
      shape([
        { id: "a", signature: "Ran command" },
        { id: "b", signature: "Ran command" },
        { id: "c", signature: "Ran command" },
        { id: "d", signature: "Read file" },
        { id: "e", signature: "Ran command" },
        { id: "f", signature: "Ran command" },
        { id: "g", signature: "Ran command" },
      ])
    ).toEqual(["run(Ran command×3)", "single(d)", "run(Ran command×3)"])
  })

  it("never folds a row that has children", () => {
    expect(
      shape([
        { id: "a", signature: "Ran command" },
        { id: "b", signature: "Ran command", hasChildren: true },
        { id: "c", signature: "Ran command" },
        { id: "d", signature: "Ran command" },
        { id: "e", signature: "Ran command" },
      ])
    ).toEqual(["single(a)", "single(b)", "run(Ran command×3)"])
  })

  it("keeps rows without a signature separate", () => {
    expect(
      shape([
        { id: "a", signature: "" },
        { id: "b", signature: "" },
        { id: "c", signature: "" },
      ])
    ).toEqual(["single(a)", "single(b)", "single(c)"])
  })

  it("gives a run a stable id derived from its first row", () => {
    const entries = fold([
      { id: "first", signature: "Ran command" },
      { id: "second", signature: "Ran command" },
      { id: "third", signature: "Ran command" },
    ])
    expect(entries[0]).toMatchObject({ type: "run", id: "run:first" })
  })

  it("preserves every row it folds", () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: `t${index}`,
      signature: "Ran command",
    }))
    const entries = fold(rows)
    const flattened = entries.flatMap((entry) =>
      entry.type === "run" ? entry.nodes : [entry.node]
    )
    expect(flattened).toEqual(rows)
  })

  it("handles an empty list", () => {
    expect(fold([])).toEqual([])
  })

  // The label is what keeps a folded run honest: the count alone would hide
  // which files were read, so the run carries every distinct detail.
  it("collects the distinct details of a run in first-seen order", () => {
    const entries = fold([
      { id: "a", signature: "Read file", detail: "a.ts" },
      { id: "b", signature: "Read file", detail: "b.ts" },
      { id: "c", signature: "Read file", detail: "a.ts" },
      { id: "d", signature: "Read file", detail: "  " },
      { id: "e", signature: "Read file" },
    ])
    expect(entries).toEqual([
      expect.objectContaining({ type: "run", details: ["a.ts", "b.ts"] }),
    ])
  })

  it("folds rows of one action even when their details differ", () => {
    expect(
      shape([
        { id: "a", signature: "Ran command", detail: "npm test" },
        { id: "b", signature: "Ran command", detail: "git status" },
        { id: "c", signature: "Ran command", detail: "npm run lint" },
      ])
    ).toEqual(["run(Ran command×3)"])
  })
})

describe("foldedRunLabel", () => {
  it("appends the count", () => {
    expect(foldedRunLabel("Ran command", 16)).toBe("Ran command ×16")
  })

  it("spells out up to three distinct details and counts the rest", () => {
    expect(foldedRunLabel("Read file", 6, ["a.ts", "b.ts", "c.ts", "d.ts"])).toBe(
      "Read file ×6 · a.ts, b.ts, c.ts, +1"
    )
    expect(foldedRunLabel("Read file", 3, ["a.ts", "b.ts"])).toBe(
      "Read file ×3 · a.ts, b.ts"
    )
    expect(foldedRunLabel("Read file", 3, [])).toBe("Read file ×3")
  })
})
