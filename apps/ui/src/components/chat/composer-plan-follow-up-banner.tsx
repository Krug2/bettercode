import { memo } from "react"
import { ListChecksIcon, PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { proposedPlanTitle } from "@/lib/proposed-plan"
import type {
  SetPlanModalContent,
  SourceProposedPlanReference,
} from "@/lib/plan-modal"

export type ComposerPlanFollowUp = {
  id: string
  content: string
  sourceProposedPlan?: SourceProposedPlanReference | null
  implemented?: boolean
  implementedAt?: string | null
  implementationThreadId?: string | null
}

export const ComposerPlanFollowUpBanner = memo(
  function ComposerPlanFollowUpBanner({
    plan,
    onOpenPlanModal,
  }: {
    plan: ComposerPlanFollowUp
    onOpenPlanModal: SetPlanModalContent
  }) {
    const title = proposedPlanTitle(plan.content)
    const openPlan = () =>
      onOpenPlanModal({
        content: plan.content,
        sourceProposedPlan: plan.sourceProposedPlan ?? null,
        implemented: Boolean(plan.implemented),
        implementedAt: plan.implementedAt ?? null,
        implementationThreadId: plan.implementationThreadId ?? null,
      })

    return (
      // Codex-style slim bar: emerald tile + tracked "PLAN READY" eyebrow
      // on the left, a single white "Open Plan" pill on the right.
      <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-border/50 bg-card/40 py-2 pr-2 pl-3">
        <ListChecksIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
        <span className="shrink-0 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Plan ready
        </span>
        {title ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
            {title}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          type="button"
          size="sm"
          className="h-7 shrink-0 gap-1.5 rounded-full px-3 text-xs font-medium"
          onClick={openPlan}
        >
          <PlayIcon className="size-3.5" />
          Open Plan
        </Button>
      </div>
    )
  }
)
