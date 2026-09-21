import { useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlayIcon,
  SearchIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { submitPlanApprovalDecision } from "@/components/chat/plan-approval-submit"
import type { PendingPlanApproval } from "@/lib/pending-approvals"
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  proposedPlanTitle,
} from "@/lib/proposed-plan"
import { MessageResponse } from "@/components/ai-elements/message"

/**
 * Inline plan-approval card (pending slot of the transcript), Codex-style:
 *
 *   [✓]  PLAN  <plan title…>            […] [🔍 Review] [▷ Implement]
 *        ⋮≡ Ready
 *   ──────────────────────────────────────────────────────────────
 *   <plan preview markdown>
 *
 * The turn is paused inside ExitPlanMode until the user approves the plan
 * or sends it back with feedback. "Implement" = approve + acceptEdits;
 * the "…" menu carries the less-common actions (manual-approval approve,
 * keep-planning feedback).
 */
export function PlanApprovalCard({
  threadId,
  planApproval,
  onReviewFullPlan,
}: {
  threadId: string
  planApproval: PendingPlanApproval
  onReviewFullPlan?: (planMarkdown: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState("")

  const decide = async (
    decision: "approve" | "deny",
    options?: { permissionMode?: "acceptEdits" | "default"; message?: string }
  ) => {
    if (submitting) return
    setSubmitting(true)
    try {
      // Never throws: a refused decision (400/502) is recorded as a failed
      // activity that clears this card, and toasted — same as the modal.
      await submitPlanApprovalDecision(threadId, planApproval, decision, options)
    } finally {
      setSubmitting(false)
    }
  }

  const hasPlanText = planApproval.planMarkdown.trim().length > 0
  const preview =
    buildCollapsedProposedPlanPreviewMarkdown(planApproval.planMarkdown) ||
    planApproval.planMarkdown
  const title = proposedPlanTitle(planApproval.planMarkdown)
  // Collapsed to the header by default, like PlanImplementationCard. "Review"
  // opens the full plan; the auto-opened approval modal shows the same preview.
  const showPreview = expanded && hasPlanText

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/50">
      {/* ── Header — clean and simple: the PLAN badge anchors the row,
          no colored icon tile. ── */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Plan
            </span>
            <span className="truncate text-[13px] font-semibold text-foreground">
              {title || "Plan ready — review and decide how to continue"}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ListChecksIcon className="size-3" strokeWidth={2} />
            Ready
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasPlanText ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={submitting}
              aria-label={expanded ? "Collapse plan" : "Expand plan"}
              aria-expanded={expanded}
              className="size-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronUpIcon className="size-4" />
              ) : (
                <ChevronDownIcon className="size-4" />
              )}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={submitting}
                aria-label="More plan actions"
                className="size-7 rounded-full text-muted-foreground hover:text-foreground"
              >
                <EllipsisIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[230px]">
              <DropdownMenuItem
                onClick={() =>
                  void decide("approve", { permissionMode: "default" })
                }
              >
                <CheckIcon className="size-3.5" />
                Approve with manual approvals
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
                <MessageSquareIcon className="size-3.5" />
                Keep planning — give feedback
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onReviewFullPlan ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              className="h-8 gap-1.5 rounded-full px-3 text-xs"
              onClick={() => onReviewFullPlan(planApproval.planMarkdown)}
            >
              <SearchIcon className="size-3.5" />
              Review
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            className="h-8 gap-1.5 rounded-full px-3.5 text-xs font-medium"
            onClick={() =>
              void decide("approve", { permissionMode: "acceptEdits" })
            }
          >
            <PlayIcon className="size-3.5" />
            Implement
          </Button>
        </div>
      </div>

      {/* ── Body: plan preview (+ optional feedback composer) ── */}
      {/* `min-w-0` on both levels: a flex/grid item defaults to
          `min-width: auto`, so a wide `<pre>` or long inline `<code>` in the
          plan would stretch this card past the transcript column instead of
          scrolling inside it. Same root cause as the plan dialog. */}
      {/* Collapsed hides the preview only — the missing-text notice and the
          feedback composer must stay reachable, or "Keep planning — give
          feedback" becomes a dead menu item. */}
      {showPreview || !hasPlanText || feedbackOpen ? (
        <div className="min-w-0 border-t border-border/40 px-4 py-3">
          {showPreview ? (
            <div className="plan-preview-prose min-w-0 text-xs leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <MessageResponse>{preview}</MessageResponse>
            </div>
          ) : !hasPlanText ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              The plan was proposed but its text isn't available here. You can
              still implement it, or keep planning to see it in the chat.
            </p>
          ) : null}
          {feedbackOpen ? (
            <div className="mt-3 flex flex-col gap-2">
              <Textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="What should change about the plan?"
                className="min-h-14 text-xs"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setFeedbackOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={submitting}
                  className="gap-1.5"
                  onClick={() =>
                    void decide("deny", {
                      message: feedback.trim() || undefined,
                    })
                  }
                >
                  <MessageSquareIcon className="size-3.5" />
                  Send feedback
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
