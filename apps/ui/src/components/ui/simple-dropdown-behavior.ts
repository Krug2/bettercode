/**
 * Close/stay-open decisions for `SimpleDropdownSub`, kept as pure functions.
 *
 * Both rules look trivial and are not: sub-menu panels are portaled to
 * `<body>`, so a nested menu is *visually* inside its parent while being a DOM
 * sibling of it. Reasoning about that from inside an event handler produced
 * two regressions in a row — opening a provider collapsed the whole model
 * picker, and clicking a model tore the list away before the click landed.
 * Isolating the decisions makes them testable without a DOM.
 */

export interface SubOpenBroadcast {
  /** Id of the sub-menu that just opened. */
  readonly openerId?: string | undefined
  /**
   * Whether the opener lives inside this menu's own panel — i.e. it is a
   * descendant, not a sibling.
   */
  readonly openerIsDescendant: boolean
}

/**
 * A sub-menu closes when a *sibling* opens, so only one flyout is on screen.
 * It must NOT close when one of its own descendants opens, or the chain it
 * is hosting disappears out from under the user.
 */
export function shouldCloseOnOtherSubOpen(
  myId: string,
  broadcast: SubOpenBroadcast
): boolean {
  if (!broadcast.openerId || broadcast.openerId === myId) return false
  return !broadcast.openerIsDescendant
}

export interface PointerDownTarget {
  readonly insideOwnTrigger: boolean
  readonly insideOwnPanel: boolean
  /** Inside ANY dropdown surface, including a portaled descendant panel. */
  readonly insideAnyDropdownPanel: boolean
}

/**
 * Dismiss on a click that lands outside every dropdown surface. A click in a
 * descendant panel is not "outside" even though the DOM says the node is
 * elsewhere; siblings are closed by the open broadcast instead, so this rule
 * can afford to be permissive.
 */
export function shouldCloseOnPointerDown(target: PointerDownTarget): boolean {
  if (target.insideOwnTrigger || target.insideOwnPanel) return false
  return !target.insideAnyDropdownPanel
}
