import { describe, expect, it } from "vitest"
import {
  activateThreadTab,
  appendPaneBalanced,
  canSplit,
  columnsFromFlat,
  countPanes,
  findPaneLocation,
  flattenColumns,
  insertPaneAt,
  MAX_COLUMNS,
  MAX_PANES,
  MAX_ROWS_PER_COLUMN,
  normalizePlacement,
  removeEmptyPanes,
  removePane,
  type Pane,
} from "./pane-layout"

type P = { id: string }
const p = (id: string): P => ({ id })

function shape<T>(columns: T[][]): number[] {
  return columns.map((column) => column.length)
}

describe("normalizePlacement", () => {
  it("maps legacy aliases and passes real placements through", () => {
    expect(normalizePlacement("before")).toBe("left")
    expect(normalizePlacement("after")).toBe("right")
    expect(normalizePlacement("into")).toBe("into")
    expect(normalizePlacement("top")).toBe("top")
    expect(normalizePlacement("bottom")).toBe("bottom")
  })
})

describe("flattenColumns / findPaneLocation", () => {
  const columns = [[p("a"), p("b")], [p("c")]]
  it("flattens column-major", () => {
    expect(flattenColumns(columns).map((x) => x.id)).toEqual(["a", "b", "c"])
  })
  it("locates panes and misses gracefully", () => {
    expect(findPaneLocation(columns, "b")).toEqual({ col: 0, row: 1 })
    expect(findPaneLocation(columns, "c")).toEqual({ col: 1, row: 0 })
    expect(findPaneLocation(columns, "zz")).toBeNull()
  })
})

describe("activateThreadTab", () => {
  it("reveals an existing background chat tab when its thread is selected", () => {
    const chatTab = {
      id: "chat-tab",
      kind: "chat" as const,
      threadId: "thread-1",
      title: "Thread 1",
    }
    const terminalTab = {
      id: "terminal-tab",
      kind: "terminal" as const,
      threadId: null,
      title: "Terminal",
    }
    const pane: Pane = {
      id: "pane-1",
      tabs: [chatTab, terminalTab],
      activeTabId: terminalTab.id,
      primaryThreadId: "another-thread",
    }

    const result = activateThreadTab(
      {
        columns: [[pane]],
        activePaneId: "pane-2",
        maximizedPaneId: "pane-2",
      },
      "thread-1"
    )

    expect(result).not.toBeNull()
    expect(result?.activePaneId).toBe("pane-1")
    expect(result?.maximizedPaneId).toBeNull()
    expect(result?.columns[0]?.[0]).toMatchObject({
      activeTabId: "chat-tab",
      primaryThreadId: "thread-1",
    })
  })

  it("returns null when no pane contains the selected thread", () => {
    expect(
      activateThreadTab(
        { columns: [], activePaneId: "pane-1", maximizedPaneId: null },
        "missing"
      )
    ).toBeNull()
  })
})

describe("insertPaneAt", () => {
  const base = [[p("a"), p("b")], [p("c")]]

  it("left/right create a new column around the target's column", () => {
    const left = insertPaneAt(base, "c", p("n"), "left")
    expect(left.map((col) => col.map((x) => x.id))).toEqual([
      ["a", "b"],
      ["n"],
      ["c"],
    ])
    const right = insertPaneAt(base, "a", p("n"), "right")
    expect(right.map((col) => col.map((x) => x.id))).toEqual([
      ["a", "b"],
      ["n"],
      ["c"],
    ])
  })

  it("top/bottom splice within the target's column", () => {
    const top = insertPaneAt(base, "b", p("n"), "top")
    expect(top[0]!.map((x) => x.id)).toEqual(["a", "n", "b"])
    const bottom = insertPaneAt(base, "c", p("n"), "bottom")
    expect(bottom[1]!.map((x) => x.id)).toEqual(["c", "n"])
    // Other columns untouched.
    expect(bottom[0]!.map((x) => x.id)).toEqual(["a", "b"])
  })

  it("appends as last column for an unknown target", () => {
    const out = insertPaneAt(base, "gone", p("n"), "bottom")
    expect(shape(out)).toEqual([2, 1, 1])
    expect(out[2]![0]!.id).toBe("n")
  })
})

describe("removePane / removeEmptyPanes", () => {
  it("collapses a column when its last pane is removed", () => {
    const out = removePane([[p("a")], [p("b"), p("c")]], "a")
    expect(shape(out)).toEqual([2])
  })

  it("drops tabless panes and then empty columns", () => {
    const pane = (id: string, tabCount: number): Pane => ({
      id,
      tabs: Array.from({ length: tabCount }, (_, i) => ({
        id: `${id}-t${i}`,
        kind: "chat",
        threadId: null,
        title: "Chat",
      })),
      activeTabId: `${id}-t0`,
      primaryThreadId: null,
    })
    const out = removeEmptyPanes([[pane("a", 0)], [pane("b", 1)]])
    expect(shape(out)).toEqual([1])
    expect(out[0]![0]!.id).toBe("b")
  })
})

describe("canSplit", () => {
  it("blocks new columns at MAX_COLUMNS", () => {
    const columns = Array.from({ length: MAX_COLUMNS }, (_, i) => [p(`c${i}`)])
    expect(canSplit(columns as never, "c0", "right")).toBe(false)
    expect(canSplit(columns as never, "c0", "bottom")).toBe(true)
  })

  it("blocks vertical splits at MAX_ROWS_PER_COLUMN", () => {
    const column = Array.from({ length: MAX_ROWS_PER_COLUMN }, (_, i) =>
      p(`r${i}`)
    )
    expect(canSplit([column] as never, "r0", "bottom")).toBe(false)
    expect(canSplit([column] as never, "r0", "right")).toBe(true)
  })

  it("blocks everything at MAX_PANES", () => {
    const columns = columnsFromFlat(
      Array.from({ length: MAX_PANES }, (_, i) => p(`p${i}`))
    )
    expect(canSplit(columns as never, "p0", "right")).toBe(false)
    expect(canSplit(columns as never, "p0", "bottom")).toBe(false)
  })
})

describe("appendPaneBalanced / columnsFromFlat", () => {
  it("reproduces the legacy auto-flow shapes 1→8", () => {
    const expected = [
      [1],
      [1, 1],
      [2, 1],
      [2, 2],
      [2, 2, 1],
      [2, 2, 2],
      [2, 2, 2, 1],
      [2, 2, 2, 2],
    ]
    let columns: P[][] = []
    for (let n = 1; n <= 8; n += 1) {
      columns = appendPaneBalanced(columns, p(`p${n}`))
      expect(shape(columns)).toEqual(expected[n - 1])
    }
  })

  it("keeps every pane exactly once through columnsFromFlat", () => {
    // Balanced placement is NOT order-preserving (panes stack onto the
    // shortest column) — only the pane SET must survive.
    const flat = Array.from({ length: 5 }, (_, i) => p(`p${i}`))
    const columns = columnsFromFlat(flat)
    expect(countPanes(columns)).toBe(5)
    expect(new Set(flattenColumns(columns).map((x) => x.id))).toEqual(
      new Set(flat.map((x) => x.id))
    )
  })
})
