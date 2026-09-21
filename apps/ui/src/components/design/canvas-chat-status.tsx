import { AgentActivityOrb } from "@/components/ai-elements/agent-activity"
import { useChatStore } from "@/lib/chat-store"
import { useThreadRunningElapsed } from "@/lib/chat/running-selectors"
import { cn } from "@/lib/utils"

/** The timer only updates this status, not the card's guest/inspector tree. */
export function CanvasChatStatus({
  threadId,
  running,
  hasError,
}: {
  threadId: string
  running: boolean
  hasError: boolean
}) {
  const elapsed = useThreadRunningElapsed(threadId)
  const needsInput = useChatStore((state) =>
    Boolean(state.streamingByThread[threadId]?.pendingQuestions?.length)
  )
  const reasoning = useChatStore((state) =>
    Boolean(state.streamingByThread[threadId]?.isReasoning)
  )
  const label = needsInput
    ? "Needs input"
    : running
      ? reasoning
        ? "Thinking"
        : "Working"
      : hasError
        ? "Error"
        : "Idle"
  const animating = running && !needsInput
  return (
    <span
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px]",
        needsInput
          ? "bg-amber-500/10 text-amber-500"
          : running
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground"
      )}
    >
      {animating ? (
        <AgentActivityOrb state={reasoning ? "breathing" : "solving"} />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            needsInput
              ? "bg-amber-500"
              : hasError
                ? "bg-destructive"
                : "bg-muted-foreground/40"
          )}
        />
      )}
      <span className={animating ? "agent-activity-text" : undefined}>
        {label}
      </span>
      {elapsed && !needsInput && (
        <span
          aria-hidden="true"
          className="font-mono text-[10px] text-muted-foreground tabular-nums"
        >
          {elapsed}
        </span>
      )}
    </span>
  )
}
