/**
 * Pure columns-of-rows layout model for the agent-mode pane grid.
 *
 * The old model was a FLAT pane array rendered through a column-count
 * auto-flow grid — it could not express vertical splits ("bottom" drops
 * silently became right splits) and left dead, drop-less grid cells
 * whenever the pane count wasn't a multiple of the column count.
 *
 * Here the layout is explicit: `columns: Pane[][]` — each column is a
 * vertical stack of panes and always fills the full height, so every
 * pixel of the grid belongs to exactly one pane's drop zone.
 *
 * All helpers are pure (no React, no stores) so they unit-test directly.
 */

export type PaneTabKind =
  | "chat"
  | "terminal"
  | "plan"
  | "diff"
  | "files"
  | "git"

export type PaneTab = {
  id: string
  kind: PaneTabKind
  threadId: string | null // only chat tabs own a thread
  title: string
}

export type Pane = {
  id: string
  tabs: PaneTab[]
  activeTabId: string
  /** Chat thread this pane is "about"; drives projectPath + header title. */
  primaryThreadId: string | null
}

export type PaneLayoutState = {
  columns: Pane[][]
  activePaneId: string
  maximizedPaneId: string | null
}

/**
 * Public layout shape: state plus the DERIVED column-major flat list.
 * `panes` order is the Ctrl+1..8 focus order — read-only consumers keep
 * working against it without knowing about columns.
 */
export type PaneLayout = PaneLayoutState & { panes: Pane[] }

export type SplitPlacement = "left" | "right" | "top" | "bottom"
export type PanePlacement = "into" | SplitPlacement
/** External alias back-compat: before→left, after→right. */
export type PanePlacementInput = PanePlacement | "before" | "after"

export const MAX_PANES = 8
export const MAX_COLUMNS = 4
export const MAX_ROWS_PER_COLUMN = 3

export function normalizePlacement(p: PanePlacementInput): PanePlacement {
  if (p === "before") return "left"
  if (p === "after") return "right"
  return p
}

type HasId = { id: string }

/** Column-major flatten — the canonical pane order (Ctrl+1..8). */
export function flattenColumns<T>(columns: T[][]): T[] {
  return columns.flat()
}

export function countPanes<T>(columns: T[][]): number {
  return columns.reduce((sum, column) => sum + column.length, 0)
}

export function findPaneLocation<T extends HasId>(
  columns: T[][],
  paneId: string
): { col: number; row: number } | null {
  for (let col = 0; col < columns.length; col += 1) {
    const row = columns[col]!.findIndex((pane) => pane.id === paneId)
    if (row >= 0) return { col, row }
  }
  return null
}

export function mapPanes<T>(columns: T[][], fn: (pane: T) => T): T[][] {
  return columns.map((column) => column.map(fn))
}

/**
 * Focus the exact chat tab that already owns `threadId`. Looking only at a
 * pane's `primaryThreadId` misses background chat tabs and can leave a terminal
 * or a different chat visible after the user selects a conversation.
 */
export function activateThreadTab(
  layout: PaneLayoutState,
  threadId: string
): PaneLayoutState | null {
  const pane = flattenColumns(layout.columns).find((candidate) =>
    candidate.tabs.some(
      (tab) => tab.kind === "chat" && tab.threadId === threadId
    )
  )
  if (!pane) return null

  const tab = pane.tabs.find(
    (candidate) => candidate.kind === "chat" && candidate.threadId === threadId
  )!
  return {
    ...layout,
    activePaneId: pane.id,
    maximizedPaneId: null,
    columns: mapPanes(layout.columns, (candidate) =>
      candidate.id === pane.id
        ? {
            ...candidate,
            activeTabId: tab.id,
            primaryThreadId: threadId,
          }
        : candidate
    ),
  }
}

/**
 * Insert `pane` relative to `targetPaneId`:
 *  - left/right → NEW column immediately before/after the target's column
 *  - top/bottom → spliced into the target's column above/below the target
 * Unknown target (stale drop payload) → appended as its own last column.
 */
export function insertPaneAt<T extends HasId>(
  columns: T[][],
  targetPaneId: string,
  pane: T,
  placement: SplitPlacement
): T[][] {
  const loc = findPaneLocation(columns, targetPaneId)
  if (!loc) return [...columns, [pane]]
  const { col, row } = loc
  if (placement === "left" || placement === "right") {
    const at = placement === "right" ? col + 1 : col
    return [...columns.slice(0, at), [pane], ...columns.slice(at)]
  }
  const at = placement === "bottom" ? row + 1 : row
  return columns.map((column, index) =>
    index === col ? [...column.slice(0, at), pane, ...column.slice(at)] : column
  )
}

/** Remove a pane; a column left empty collapses away. */
export function removePane<T extends HasId>(
  columns: T[][],
  paneId: string
): T[][] {
  return columns
    .map((column) => column.filter((pane) => pane.id !== paneId))
    .filter((column) => column.length > 0)
}

/** Drop panes that lost their last tab, then drop emptied columns. */
export function removeEmptyPanes(columns: Pane[][]): Pane[][] {
  return columns
    .map((column) => column.filter((pane) => pane.tabs.length > 0))
    .filter((column) => column.length > 0)
}

/**
 * Whether a split can be honored without blowing a cap. Callers fall
 * back to "into" when false, so a drop always does something sensible.
 */
export function canSplit(
  columns: Pane[][],
  targetPaneId: string,
  placement: SplitPlacement
): boolean {
  if (countPanes(columns) >= MAX_PANES) return false
  const loc = findPaneLocation(columns, targetPaneId)
  if (!loc) return columns.length < MAX_COLUMNS
  if (placement === "left" || placement === "right") {
    return columns.length < MAX_COLUMNS
  }
  return columns[loc.col]!.length < MAX_ROWS_PER_COLUMN
}

/** Column count the balanced append aims for (old gridColsFor curve). */
function desiredColumns(paneCount: number): number {
  if (paneCount <= 1) return 1
  if (paneCount <= 4) return 2
  if (paneCount <= 6) return 3
  return 4
}

/**
 * Append reproducing the old auto-flow shapes: open a new column while
 * under the desired count for the new total, else stack onto the
 * currently shortest column. Progression: [1] [1,1] [2,1] [2,2] [2,2,1]
 * [2,2,2] [2,2,2,1] [2,2,2,2].
 */
export function appendPaneBalanced<T>(columns: T[][], pane: T): T[][] {
  const nextCount = countPanes(columns) + 1
  if (columns.length < desiredColumns(nextCount)) {
    return [...columns, [pane]]
  }
  let shortest = 0
  for (let i = 1; i < columns.length; i += 1) {
    if (columns[i]!.length < columns[shortest]!.length) shortest = i
  }
  return columns.map((column, index) =>
    index === shortest ? [...column, pane] : column
  )
}

/** Flat list → balanced columns (also the future persistence migration). */
export function columnsFromFlat<T>(panes: T[]): T[][] {
  let columns: T[][] = []
  for (const pane of panes) columns = appendPaneBalanced(columns, pane)
  return columns
}
