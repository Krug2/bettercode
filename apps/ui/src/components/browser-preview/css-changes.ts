import type { CssChange } from "./types"

export function recordCssChange(
  changes: CssChange[],
  change: CssChange
): CssChange[] {
  const matches = (item: CssChange) =>
    item.selector === change.selector && item.property === change.property
  const existing = changes.find(matches)
  const next = { ...change, oldValue: existing?.oldValue ?? change.oldValue }
  if (next.newValue === next.oldValue)
    return changes.filter((item) => !matches(item))
  return existing
    ? changes.map((item) => (matches(item) ? next : item))
    : [...changes, next]
}
