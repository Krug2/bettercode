import { useMemo, useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  MessageSquareIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useApprovalModalStore } from "@/lib/approval-modal-store"
import { useChatStore, useThreadActivities } from "@/lib/chat-store"
import { stripProposedPlanWrapper } from "@/lib/plan-content"
import {
  derivePendingApprovals,
  derivePendingPlanApprovals,
} from "@/lib/pending-approvals"
import { usePreferencesStore } from "@/lib/preferences-store"
import {
  ALWAYS_ALLOW_DESTINATIONS,
  ApprovalRequestContext,
  alwaysAllowRules,
  buildAlwaysAllowUpdate,
  describeAlwaysAllowRules,
  submitApprovalDecision,
} from "@/components/chat/approval-request-context"
import { submitPlanApprovalDecision } from "@/components/chat/plan-approval-submit"
import { MessageResponse } from "@/components/ai-elements/message"
import { buildCollapsedProposedPlanPreviewMarkdown } from "@/lib/proposed-plan"
import { cn } from "@/lib/utils"

/**
 * Focused approval dialog ("Modal + Inline" UX): opens for the newest
 * pending request when its thread is in the foreground. Dismissing keeps
 * the inline transcript row as the fallback surface.
 */
export function ApprovalRequestModal() {
  const target = useApprovalModalStore((state) => state.target)
  const dismiss = useApprovalModalStore((state) => state.dismiss)
  const close = useApprovalModalStore((state) => state.close)
  const activities = useThreadActivities(target?.threadId ?? null)

  const approval = useMemo(() => {
    if (!target || target.kind !== "tool_approval") return null
    return (
      derivePendingApprovals(activities ?? []).find(
        (item) => item.requestId === target.requestId
      ) ?? null
    )
  }, [target, activities])

  const planApproval = useMemo(() => {
    if (!target || target.kind !== "plan_approval") return null
    return (
      derivePendingPlanApprovals(activities ?? []).find(
        (item) => item.requestId === target.requestId
      ) ?? null
    )
  }, [target, activities])

  // Last-resort plan text: providers occasionally raise the approval with no
  // plan payload AND no `turn.proposed.completed` activity (the plan lives
  // only in the assistant message that streamed it). Pull the newest
  // <proposed_plan> block from this thread's messages so the preview isn't
  // blank.
  const threadMessages = useChatStore((state) =>
    target?.threadId
      ? state.threads.find((thread) => thread.id === target.threadId)?.messages
      : undefined
  )
  const planTurnId = planApproval?.turnId
  const planMarkdownFromMessages = useMemo(() => {
    if (!threadMessages) return ""
    // Prefer the plan streamed in the request's OWN turn; only if none
    // matches do we fall back to the newest <proposed_plan> in the thread.
    let newest = ""
    for (let i = threadMessages.length - 1; i >= 0; i--) {
      const message = threadMessages[i]
      if (message.role !== "assistant") continue
      const content = message.content ?? ""
      if (!/<proposed_plan>/i.test(content)) continue
      const extracted = stripProposedPlanWrapper(content)
      if (!extracted) continue
      if (planTurnId && message.turnId === planTurnId) return extracted
      if (!newest) newest = extracted
    }
    return planTurnId ? "" : newest
  }, [threadMessages, planTurnId])

  const effectivePlanMarkdown =
    (planApproval?.planMarkdown?.trim() ? planApproval.planMarkdown : "") ||
    planMarkdownFromMessages

  const [submitting, setSubmitting] = useState(false)
  const [denyMessageOpen, setDenyMessageOpen] = useState(false)
  const [denyMessage, setDenyMessage] = useState("")

  // Resolved/stale requests close the modal automatically (no pending match).
  const open = Boolean(target && (approval || planApproval))
  if (target && !approval && !planApproval) {
    // Defer the store update out of render.
    queueMicrotask(close)
  }

  const resetLocal = () => {
    setSubmitting(false)
    setDenyMessageOpen(false)
    setDenyMessage("")
  }

  const decideTool = async (
    decision: "approve" | "deny",
    options?: Parameters<typeof submitApprovalDecision>[3]
  ) => {
    if (!target || !approval || submitting) return
    setSubmitting(true)
    try {
      // Never throws: a refused decision is recorded as a failed activity
      // (which clears the request) and toasted, so the modal closes on both
      // outcomes instead of staying open over a request nobody can answer.
      await submitApprovalDecision(target.threadId, approval, decision, options)
    } finally {
      close()
      resetLocal()
    }
  }

  const decidePlan = async (
    decision: "approve" | "deny",
    options?: { permissionMode?: "acceptEdits" | "default"; message?: string }
  ) => {
    if (!target || !planApproval || submitting) return
    setSubmitting(true)
    try {
      // Never throws: a refused plan response is recorded as a failed
      // activity (which clears the card) and toasted, shared with the
      // inline card so both surfaces behave the same.
      await submitPlanApprovalDecision(
        target.threadId,
        planApproval,
        decision,
        options
      )
    } finally {
      close()
      resetLocal()
    }
  }

  const isReadOnly =
    usePreferencesStore((state) => state.permissionLevel) === "read-only"
  // `null` when this call has no scope narrow enough to remember safely (a
  // chained or substituting command, a tool with no path, or a provider
  // suggestion that arrived unscoped). The dropdown is hidden in that case
  // rather than silently degrading to a one-off approve. The label renders the
  // same rule array that gets persisted, so the two cannot drift.
  const alwaysAllowScopeRules = approval ? alwaysAllowRules(approval) : null
  const alwaysAllowScope = alwaysAllowScopeRules
    ? describeAlwaysAllowRules(alwaysAllowScopeRules)
    : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          dismiss()
          resetLocal()
        }
      }}
    >
      {/* Plan review gets more room than a tool prompt: it is a wall of prose
          with inline code chips and file paths, and it is the surface where the
          user decides whether an agent may start editing. A tool approval is a
          few lines and stays narrow. */}
      <DialogContent
        className={cn(
          "max-h-[85vh] overflow-x-hidden overflow-y-auto",
          planApproval && !approval ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
      >
        {approval ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlertIcon className="size-4 text-warning" />
                Approval required
              </DialogTitle>
              <DialogDescription>
                {approval.toolName ?? "A tool"} wants to run in this thread.
              </DialogDescription>
            </DialogHeader>
            <ApprovalRequestContext approval={approval} />
            {denyMessageOpen ? (
              <Textarea
                value={denyMessage}
                onChange={(event) => setDenyMessage(event.target.value)}
                placeholder="Tell Claude why this was denied (optional feedback)…"
                className="min-h-16 text-xs"
                autoFocus
              />
            ) : null}
            <DialogFooter className="sm:justify-between">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => {
                    if (denyMessageOpen) {
                      void decideTool("deny", {
                        message: denyMessage.trim() || undefined,
                      })
                    } else {
                      setDenyMessageOpen(true)
                    }
                  }}
                >
                  <MessageSquareIcon className="size-3.5" />
                  {denyMessageOpen ? "Send & deny" : "Deny with message"}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => void decideTool("deny")}
                >
                  <XIcon className="size-3.5" />
                  Deny
                </Button>
                {!isReadOnly && alwaysAllowScope ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={submitting}
                      >
                        Always allow
                        <ChevronDownIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {ALWAYS_ALLOW_DESTINATIONS.map((destination) => (
                        <DropdownMenuItem
                          key={destination.id}
                          onClick={() => {
                            const update = buildAlwaysAllowUpdate(
                              approval,
                              destination.id
                            )
                            void decideTool("approve", {
                              updatedPermissions: update ? [update] : undefined,
                            })
                          }}
                        >
                          <span className="flex flex-col items-start">
                            <span>{destination.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {alwaysAllowScope}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={submitting}
                  onClick={() => void decideTool("approve")}
                >
                  <CheckIcon className="size-3.5" />
                  Allow
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : planApproval ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlertIcon className="size-4 text-primary" />
                Review the proposed plan
              </DialogTitle>
              <DialogDescription>
                Approve to implement, or send it back with feedback.
              </DialogDescription>
            </DialogHeader>
            {/* No nested scroll box: the plan is shown collapsed (its full
                text lives in the chat transcript), so it reads as clean prose
                inside the dialog rather than a bordered card with an inner
                scrollbar. */}
            <div className="plan-preview-prose min-w-0 border-t border-border/40 pt-3 text-xs leading-relaxed text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              {effectivePlanMarkdown.trim() ? (
                <MessageResponse>
                  {buildCollapsedProposedPlanPreviewMarkdown(
                    effectivePlanMarkdown
                  ) || effectivePlanMarkdown}
                </MessageResponse>
              ) : (
                <p>
                  The plan was proposed but its text isn't available here. You
                  can still approve it, or keep planning to see it in the chat.
                </p>
              )}
            </div>
            {denyMessageOpen ? (
              <Textarea
                value={denyMessage}
                onChange={(event) => setDenyMessage(event.target.value)}
                placeholder="What should change about the plan?"
                className="min-h-16 text-xs"
                autoFocus
              />
            ) : null}
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  if (denyMessageOpen) {
                    void decidePlan("deny", {
                      message: denyMessage.trim() || undefined,
                    })
                  } else {
                    setDenyMessageOpen(true)
                  }
                }}
              >
                <MessageSquareIcon className="size-3.5" />
                {denyMessageOpen ? "Send feedback" : "Keep planning"}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() =>
                    void decidePlan("approve", { permissionMode: "default" })
                  }
                >
                  Approve (manual approvals)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={submitting}
                  onClick={() =>
                    void decidePlan("approve", {
                      permissionMode: "acceptEdits",
                    })
                  }
                >
                  <CheckIcon className="size-3.5" />
                  Approve & implement
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
