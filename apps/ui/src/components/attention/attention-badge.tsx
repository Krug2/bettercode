import { cn } from "@/lib/utils"
import { useThreadAttention } from "@/lib/attention-store"
import { useSettingsStore } from "@/lib/settings-store"

/**
 * Compact count pill shown on pane tabs and sidebar thread rows when a
 * thread is waiting on the user (approvals, questions, plan reviews).
 */
export function AttentionBadge({
  threadId,
  className,
}: {
  threadId: string | null
  className?: string
}) {
  const attention = useThreadAttention(threadId)
  const enabled = useSettingsStore((state) => state.attentionBadges)
  if (!enabled || !attention || attention.total === 0) return null

  const parts: string[] = []
  if (attention.approvals > 0) parts.push(`${attention.approvals} approval(s)`)
  if (attention.questions > 0) parts.push(`${attention.questions} question(s)`)
  if (attention.planApprovals > 0) parts.push("plan review")
  const summary = parts.join(", ")

  return (
    <span
      aria-label={`${attention.total} item(s) need attention: ${summary}`}
      title={summary}
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground tabular-nums",
        className
      )}
    >
      {attention.total > 9 ? "9+" : attention.total}
    </span>
  )
}
