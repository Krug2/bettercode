import { MultiAgentGridView } from "@/components/multi-agent-session-panel"
import { useMultiAgentStore } from "@/lib/multi-agent-store"
import { buildSystemInstruction } from "@/lib/mode-instructions"
import { resolveProviderTarget } from "@/lib/resolve-provider-target"
import type { UiProvider } from "@/lib/provider-types"

/**
 * Thin wrapper around `<MultiAgentGridView>` that wires the pause / resume
 * / cancel handlers to the multi-agent store.
 *
 * Resume has to re-resolve each sub-agent's provider + model through
 * `resolveProviderTarget` (auto-rerouting to OpenRouter if the direct
 * provider's key disappeared) and build a fresh system prompt per agent
 * via `buildSystemInstruction` — both live at the main-app level so they
 * can share state with the single-chat path.
 */
export function MultiAgentSwarmView({
  providers,
}: {
  providers: UiProvider[]
}) {
  return (
    <div className="flex-1 overflow-hidden">
      <MultiAgentGridView
        onPause={() => useMultiAgentStore.getState().pauseSession()}
        onResume={() => {
          const resolve = async (pid: string, mid: string) => {
            const p = providers.find((pr) => pr.id === pid)
            return resolveProviderTarget(p, mid)
          }
          useMultiAgentStore
            .getState()
            .resumeSession(resolve, (m) => buildSystemInstruction(m))
        }}
        onCancel={() => useMultiAgentStore.getState().cancelSession()}
      />
    </div>
  )
}
