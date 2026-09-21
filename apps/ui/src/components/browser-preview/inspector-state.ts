import { recordCssChange } from "./css-changes"
import type { CssChange, DomNode, SelectedElement } from "./types"

/**
 * The element inspector's state as pure data with pure transitions. The
 * editor's preview panel keeps it in React state and the canvas keeps it in
 * a store; both go through these functions, so picking, style editing and
 * the "Send to AI" batch behave identically in either host.
 */

export type InspectorTab = "tree" | "styles"

export interface ElementInspectorState {
  readonly tree: DomNode | null
  readonly selected: SelectedElement | null
  readonly editedStyles: Readonly<Record<string, string>>
  readonly cssChanges: readonly CssChange[]
  readonly tab: InspectorTab
}

/** A `bc-*` command for the previewed page (`PreviewViewportHandle.postToPreview`). */
export type PreviewCommand =
  | { type: "bc-apply-style"; selector: string; property: string; value: string }
  | { type: "bc-highlight"; selector: string }
  | { type: "bc-select"; selector: string }

export const EMPTY_INSPECTOR_STATE: ElementInspectorState = {
  tree: null,
  selected: null,
  editedStyles: {},
  cssChanges: [],
  tab: "tree",
}

export function withDomTree(
  state: ElementInspectorState,
  tree: DomNode | null
): ElementInspectorState {
  return state.tree === tree ? state : { ...state, tree }
}

/** A pick in the page: show its computed styles right away. */
export function withSelectedElement(
  state: ElementInspectorState,
  element: SelectedElement
): ElementInspectorState {
  return {
    ...state,
    selected: element,
    editedStyles: element.styles ?? {},
    tab: "styles",
  }
}

export function withoutSelection(
  state: ElementInspectorState
): ElementInspectorState {
  return state.selected === null ? state : { ...state, selected: null }
}

/** The page navigated: its tree and selection no longer exist. */
export function withPageChange(
  state: ElementInspectorState
): ElementInspectorState {
  return { ...state, tree: null, selected: null }
}

export function withTab(
  state: ElementInspectorState,
  tab: InspectorTab
): ElementInspectorState {
  return state.tab === tab ? state : { ...state, tab }
}

/**
 * One style edit: remembered against the element's original value (so a
 * revert drops out of the batch) and turned into the page command.
 */
export function withStyleChange(
  state: ElementInspectorState,
  property: string,
  value: string
): { state: ElementInspectorState; command: PreviewCommand | null } {
  const selected = state.selected
  if (!selected) return { state, command: null }
  const oldValue = selected.styles[property] || ""
  return {
    state: {
      ...state,
      editedStyles: { ...state.editedStyles, [property]: value },
      cssChanges: recordCssChange([...state.cssChanges], {
        selector: selected.selector,
        property,
        oldValue,
        newValue: value,
      }),
    },
    command: {
      type: "bc-apply-style",
      selector: selected.selector,
      property,
      value,
    },
  }
}

export function withoutCssChanges(
  state: ElementInspectorState
): ElementInspectorState {
  return state.cssChanges.length === 0 ? state : { ...state, cssChanges: [] }
}

export function highlightCommand(selector: string): PreviewCommand {
  return { type: "bc-highlight", selector }
}

export function selectCommand(selector: string): PreviewCommand {
  return { type: "bc-select", selector }
}

/** The chat request that turns buffered style edits into a code change. */
export function cssChangesPrompt(
  changes: readonly CssChange[],
  pageUrl: string
): string {
  const description = changes
    .map(
      (change) =>
        `- \`${change.selector}\`: ${change.property}: ${change.oldValue} -> ${change.newValue}`
    )
    .join("\n")
  return `Apply these visual changes to the codebase:\n\n${description}\n\nPage: ${pageUrl}`
}
