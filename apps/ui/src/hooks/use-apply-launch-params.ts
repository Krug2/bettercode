import { useEffect, useRef } from "react"
import { useChatStore } from "@/lib/chat-store"
import { getLaunchParams } from "@/lib/launch-params"
import { usePreferencesStore } from "@/lib/preferences-store"
import { editorWorkspaceKey } from "@/lib/editor-workspace"
import { resolveThreadRuntimePath } from "@/lib/thread-context"
import {
  readEditorChatLayout,
  usesComposerTabs,
} from "@/lib/editor-chat-layout"

/**
 * Apply per-window launch params (`#mode=editor&cwd=<path>`) to the
 * runtime state on first mount.
 *
 * Preferences load the window's mode independently. After history has loaded,
 * select a conversation in the launch folder, or create one if none exists.
 *
 * Runs once per renderer lifetime — the ref guards against React
 * Strict Mode's double-invoke and against re-fires on mode flips that
 * cascade back through `useEffect` deps.
 */
export function useApplyLaunchParams(opts: {
  threadsReady: boolean
}): void {
  const { threadsReady } = opts
  const workspaceAppliedRef = useRef(false)

  useEffect(() => {
    // Design windows share the editor's tab layout, so they remember the
    // same chat for a launch folder.
    const hasComposerTabs = usesComposerTabs(
      usePreferencesStore.getState().appMode
    )
    if (!threadsReady || workspaceAppliedRef.current) return
    workspaceAppliedRef.current = true
    const launch = getLaunchParams()
    if (launch.cwd) {
      const store = useChatStore.getState()
      // Wait for history before resolving a launch folder. Otherwise every
      // reload creates another empty conversation before hydration completes.
      const layout = hasComposerTabs ? readEditorChatLayout() : null
      const rememberedId = layout?.tabs.find(
        (tab) => tab.id === layout.activeTabId
      )?.threadId
      const matching = store.threads.filter((thread) =>
        editorWorkspaceKey(resolveThreadRuntimePath(thread) ?? "") ===
          editorWorkspaceKey(launch.cwd!)
      )
      const existing =
        matching.find((thread) => thread.id === rememberedId) ?? matching[0]
      if (existing) {
        store.setActiveThread(existing.id)
      } else {
        // Derive a project name from the last segment of the path so the
        // sidebar shows something meaningful instead of a long absolute
        // path. Trailing slashes are tolerated on both POSIX and Windows.
        const trimmed = launch.cwd.replace(/[\\/]+$/, "")
        const projectName =
          trimmed.split(/[\\/]/).filter(Boolean).pop() || "project"
        store.createThread("New Chat", projectName, launch.cwd)
      }
    }
  }, [threadsReady])
}
