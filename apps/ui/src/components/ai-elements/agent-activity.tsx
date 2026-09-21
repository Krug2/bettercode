import { ThinkingOrb, type OrbState } from "thinking-orbs"
import { cn } from "@/lib/utils"
import { useAppearanceStore } from "@/lib/appearance-store"

export const agentActivityPillClassName =
  "inline-flex w-fit max-w-full items-center gap-2 rounded-full bg-foreground/[0.025] py-2 pl-2.5 pr-3.5 text-[13px] font-medium leading-5 text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]"

/** Decorative: the adjacent label owns the accessible status. The library
 * handles reduced motion, theme changes and offscreen/background pausing. */
export function AgentActivityOrb({ state }: { state: OrbState }) {
  const animationsEnabled = useAppearanceStore((appearance) => appearance.animationsEnabled)
  return <ThinkingOrb state={state} size={20} theme="auto" paused={!animationsEnabled} aria-hidden="true"
    data-agent-orb={state} className="shrink-0" />
}

export function AgentActivity({ state, label, className }: {
  state: OrbState
  label: string
  className?: string
}) {
  return (
    <span role="status" className={cn(agentActivityPillClassName, className)}>
      <AgentActivityOrb state={state} />
      <span className="agent-activity-text min-w-0 truncate">{label}</span>
    </span>
  )
}
