import { Spinner } from "@/components/kibo-ui/spinner"
import { useThreadIsRunning } from "@/lib/chat/running-selectors"

/**
 * Running indicator for a pane tab. Pane tabs showed pending-approval badges
 * but nothing for work in progress, so in a multi-pane grid there was no way
 * to tell which pane was generating without opening it.
 */
export function PaneRunningDot({
  threadId,
}: {
  threadId: string | null | undefined
}) {
  const isRunning = useThreadIsRunning(threadId)
  if (!isRunning) return null
  return (
    <span
      className="flex shrink-0 items-center text-primary"
      aria-label="Working"
      title="Working"
    >
      <Spinner variant="bars" size={10} />
    </span>
  )
}
