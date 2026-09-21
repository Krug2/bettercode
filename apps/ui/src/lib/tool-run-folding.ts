/**
 * Folds runs of same-action tool rows into one collapsible entry.
 *
 * A long turn can produce hundreds of rows — forty greps, then a dozen file
 * reads, then forty greps again. Row by row the list stops carrying
 * information and just pushes the interesting rows off the screen.
 *
 * A run is a sequence of *adjacent* rows with the same signature (the action
 * label, e.g. "Read file"). The folded row keeps what distinguishes its
 * members visible — the distinct details (file names, patterns, commands) go
 * into the label — so a count never hides what the agent actually did.
 *
 * Folding is deliberately limited to consecutive rows: reordering the list to
 * group non-adjacent calls would misrepresent the order of events.
 */

/** Runs shorter than this stay expanded — folding two rows saves nothing. */
export const MIN_FOLDED_RUN_LENGTH = 3

/** How many distinct details a folded label spells out before "+N". */
export const FOLDED_LABEL_DETAIL_LIMIT = 3

export interface FoldableToolNode {
  readonly id: string
  readonly kind: string
  /** The action label the row shows, used to decide whether rows fold together. */
  readonly signature: string
  /** What distinguishes this row within its action (file, pattern, command). */
  readonly detail?: string
  /** A row with children is a parent; never fold those away. */
  readonly hasChildren: boolean
}

export type FoldedToolEntry<TNode> =
  | { readonly type: "single"; readonly node: TNode }
  | {
      readonly type: "run"
      /** Stable across renders: derived from the first node in the run. */
      readonly id: string
      readonly signature: string
      /** Distinct member details in first-seen order. */
      readonly details: ReadonlyArray<string>
      readonly nodes: ReadonlyArray<TNode>
    }

/**
 * Groups adjacent nodes that share a signature. Nodes with children, or whose
 * signature is empty, are always emitted on their own — a parent row carries
 * structure that a count would hide, and an empty signature marks a row the
 * caller wants kept visible (a failure, for instance).
 */
export function foldRepeatedToolRuns<TNode>(
  nodes: ReadonlyArray<TNode>,
  describe: (node: TNode) => FoldableToolNode,
  minRunLength: number = MIN_FOLDED_RUN_LENGTH
): FoldedToolEntry<TNode>[] {
  const entries: FoldedToolEntry<TNode>[] = []
  let run: TNode[] = []
  let runDetails: string[] = []
  let runSignature: string | null = null

  const flush = () => {
    if (run.length === 0) return
    if (runSignature && run.length >= minRunLength) {
      entries.push({
        type: "run",
        id: `run:${describe(run[0] as TNode).id}`,
        signature: runSignature,
        details: runDetails,
        nodes: run,
      })
    } else {
      for (const node of run) entries.push({ type: "single", node })
    }
    run = []
    runDetails = []
    runSignature = null
  }

  const pushDetail = (detail: string | undefined) => {
    const trimmed = detail?.trim()
    if (trimmed && !runDetails.includes(trimmed)) runDetails.push(trimmed)
  }

  for (const node of nodes) {
    const described = describe(node)
    const foldable = !described.hasChildren && described.signature.length > 0
    if (!foldable) {
      flush()
      entries.push({ type: "single", node })
      continue
    }
    if (runSignature === described.signature) {
      run.push(node)
      pushDetail(described.detail)
      continue
    }
    flush()
    run = [node]
    runSignature = described.signature
    pushDetail(described.detail)
  }
  flush()
  return entries
}

/**
 * Label for a folded run, e.g. `Read file` + 6 + [a.ts, b.ts, c.ts, d.ts] →
 * "Read file ×6 · a.ts, b.ts, c.ts, +1". Kept separate from the fold so the
 * caller owns wording and translation.
 */
export function foldedRunLabel(
  signature: string,
  count: number,
  details: ReadonlyArray<string> = []
): string {
  const label = `${signature} ×${count}`
  if (details.length === 0) return label
  const shown = details.slice(0, FOLDED_LABEL_DETAIL_LIMIT)
  const rest = details.length - shown.length
  return `${label} · ${shown.join(", ")}${rest > 0 ? `, +${rest}` : ""}`
}
