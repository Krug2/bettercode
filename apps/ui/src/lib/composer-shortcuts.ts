/**
 * True if the keyboard event target is an editable text field — used to skip
 * composer/pane shortcuts (Ctrl+W etc.) while the user is typing. Shared by the
 * composer-tabs (editor) and panes (agent) hooks.
 */
export function isComposerShortcutTextEntryTarget(
  target: Element | null
): boolean {
  if (!target) return false
  if (target.closest("[contenteditable='true']")) return true
  const element = target.closest("input, textarea, select")
  if (!element) return false
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !element.disabled
  }
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return !element.disabled
  }
  return true
}
