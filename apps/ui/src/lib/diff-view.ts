import { usePreferencesStore, type PreferencesState } from "./preferences-store"

export function isDiffViewOpen(
  preferences: Pick<
    PreferencesState,
    "appMode" | "diffOpen" | "sidebarOpen" | "editorSidebarView"
  >
): boolean {
  return preferences.appMode === "agent"
    ? preferences.diffOpen
    : preferences.sidebarOpen && preferences.editorSidebarView === "diff"
}

/** All entry points use the diff surface belonging to the current mode. */
export function setDiffViewOpen(open: boolean): void {
  const preferences = usePreferencesStore.getState()
  if (preferences.appMode === "agent") {
    preferences.setMultiple({
      diffOpen: open,
      ...(open ? { workspaceTab: "diff" } : {}),
    })
    return
  }
  preferences.setMultiple({
    // Close the legacy editor bottom panel so it cannot duplicate this view.
    diffOpen: false,
    ...(open
      ? { sidebarOpen: true, editorSidebarView: "diff" }
      : preferences.editorSidebarView === "diff"
        ? { editorSidebarView: "files" }
        : {}),
  })
}

export function toggleDiffView(): boolean {
  const open = !isDiffViewOpen(usePreferencesStore.getState())
  setDiffViewOpen(open)
  return open
}
