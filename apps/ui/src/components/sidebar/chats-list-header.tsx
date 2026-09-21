import {
  ArrowUpIcon,
  CheckIcon,
  MessageSquareTextIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ChatDateFilter = "all" | "today" | "week" | "month"

/**
 * "Chats" section header shown above the sidebar thread list in
 * extended UI mode.
 *
 * In Simple UI mode the parent doesn't render this at all (the thread
 * list itself is the content and an extra header adds visual noise).
 *
 * The right-hand controls are a date-range filter and a view-toggle
 * placeholder — the latter is currently a static icon, kept as a visual
 * anchor while the actual sort/group options live elsewhere.
 */
export function SidebarChatsListHeader({
  chatDateFilter,
  setChatDateFilter,
}: {
  chatDateFilter: string
  setChatDateFilter: (filter: ChatDateFilter) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
      <MessageSquareTextIcon className="size-3.5 text-sidebar-foreground" />
      <span className="flex-1 text-xs text-sidebar-foreground">Chats</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <ArrowUpIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[120px]">
          {(["all", "today", "week", "month"] as const).map((f) => (
            <DropdownMenuItem key={f} onClick={() => setChatDateFilter(f)}>
              <span className="flex-1">
                {f === "all"
                  ? "All time"
                  : f === "today"
                    ? "Today"
                    : f === "week"
                      ? "Last 7 days"
                      : "Last 30 days"}
              </span>
              {chatDateFilter === f && (
                <CheckIcon className="size-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-sidebar-foreground hover:bg-sidebar-accent"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="size-3.5"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="14" y2="12" />
          <line x1="4" y1="18" x2="8" y2="18" />
        </svg>
      </Button>
    </div>
  )
}
