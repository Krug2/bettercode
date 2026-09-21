import type { EditorTab } from "@/lib/editor-store"

function formatDirtyEditorList(tabs: readonly EditorTab[]): string {
  const shown = tabs.slice(0, 5).map((tab) => `- ${tab.fileName}`)
  const hiddenCount = tabs.length - shown.length
  return [
    ...shown,
    ...(hiddenCount > 0 ? [`- and ${hiddenCount} more`] : []),
  ].join("\n")
}

export function confirmCloseDirtyEditorTabs(
  tabs: readonly EditorTab[],
  actionLabel = "close"
): boolean {
  const dirtyTabs = tabs.filter((tab) => tab.isDirty)
  if (dirtyTabs.length === 0) return true
  if (typeof globalThis.confirm !== "function") return false

  const plural = dirtyTabs.length === 1 ? "" : "s"
  const message = [
    `Discard unsaved changes before ${actionLabel}?`,
    "",
    `${dirtyTabs.length} modified editor${plural}:`,
    formatDirtyEditorList(dirtyTabs),
    "",
    "Unsaved edits will be kept only in the in-memory recently closed list. Save first if you want them written to disk.",
  ].join("\n")

  return globalThis.confirm(message)
}
