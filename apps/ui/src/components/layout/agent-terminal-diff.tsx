import { ErrorBoundary } from "@/components/error-boundary"
import { TerminalPanel } from "@/components/terminal-panel"
import { DiffPanel } from "@/components/diff-panel"

/**
 * Agent-mode bottom panels: the in-chat Terminal and the Diff viewer.
 *
 * In editor mode these live inside the editor column instead (see
 * {@link EditorModeSplitView}). Here, in agent mode, they sit below the
 * chat conversation column — each is independently togglable via the
 * chat toolbar buttons, and both get the active thread's project path
 * as cwd so they stay scoped to the thread the user is actively
 * chatting in.
 */
export function AgentTerminalDiff({
  threadId,
  projectPath,
  terminalOpen,
  setTerminalOpen,
  diffOpen,
  setDiffOpen,
}: {
  threadId?: string | null
  projectPath: string | null | undefined
  terminalOpen: boolean
  setTerminalOpen: (open: boolean) => void
  diffOpen: boolean
  setDiffOpen: (open: boolean) => void
}) {
  return (
    <>
      <ErrorBoundary label="Terminal">
        <TerminalPanel
          threadId={threadId}
          open={terminalOpen}
          onClose={() => setTerminalOpen(false)}
          cwd={projectPath || undefined}
          mode="agent"
        />
      </ErrorBoundary>
      <DiffPanel
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        cwd={projectPath || undefined}
      />
    </>
  )
}
