import type { ChatThread } from "@betterc0de/schema"
import {
  CheckIcon,
  FolderIcon,
  GitBranchIcon,
  MessageSquareIcon,
  Rows2Icon,
  XIcon,
} from "lucide-react"
import { CommandItem } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { getModelInfo } from "@/lib/get-model-info"
import { logoNeedsDarkInvert } from "@/lib/logo-invert"
import {
  chatActivityLabel,
  chatModelSelection,
  chatProjectLabel,
} from "@/lib/chat-switcher-details"

export function ChatSwitcherEntry({
  thread,
  label,
  selectedModel,
  active,
  running,
  inSplit,
  tabId,
  unavailable,
  onSelect,
  onClose,
}: {
  thread?: ChatThread
  label: string
  selectedModel?: string
  active?: boolean
  running?: boolean
  inSplit?: boolean
  tabId?: string
  unavailable?: boolean
  onSelect: () => void
  onClose?: () => void
}) {
  const selection = chatModelSelection(thread, selectedModel)
  const model = getModelInfo(selection.id)
  const project = chatProjectLabel(thread)
  const count = Math.max(
    thread?.messageCount ?? 0,
    thread?.messages.length ?? 0
  )
  const modelLabel = model?.name ?? "Model not recorded"
  const modelDescription =
    selection.source === "used"
      ? "Last used model"
      : selection.source === "selected"
        ? "Selected model · not used yet"
        : "No model recorded"
  const updatedAt = thread?.updatedAt

  return (
    <CommandItem
      value={`${tabId ? "open" : "history"} ${tabId ?? thread?.id} ${label} ${modelLabel} ${selection.id ?? ""} ${project} ${thread?.projectPath ?? ""} ${thread?.branch ?? ""}`}
      aria-disabled={unavailable || undefined}
      data-chat-switcher-tab={tabId}
      data-chat-switcher-history={tabId ? undefined : thread?.id}
      data-active={active || undefined}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group/chat-entry my-0.5 min-h-[76px] gap-2.5 rounded-lg px-2.5 py-2.5 font-normal transition-colors duration-100 data-[selected=true]:bg-accent/70 [&>svg:last-child]:hidden",
        active
          ? "data-[selected=false]:bg-muted/60"
          : "data-[selected=false]:bg-transparent",
        unavailable && "[&>span]:opacity-50"
      )}
      onSelect={() => {
        if (!unavailable) onSelect()
      }}
    >
      <span
        aria-hidden="true"
        className="relative grid size-8 shrink-0 place-items-center self-start rounded-lg border border-border/40 bg-background/60 text-muted-foreground"
      >
        {model?.logo ? (
          <img
            src={model.logo}
            alt=""
            className={cn(
              "size-4 object-contain",
              logoNeedsDarkInvert(model.logo) && "dark:invert"
            )}
          />
        ) : (
          <MessageSquareIcon className="size-4" strokeWidth={1.5} />
        )}
        {running && (
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-popover" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            title={label}
            className="min-w-0 flex-1 truncate text-[12px] leading-4 font-semibold text-popover-foreground"
          >
            {label}
          </span>
          {active ? (
            <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <CheckIcon className="size-3" />
              Current
            </span>
          ) : (
            updatedAt && (
              <time
                dateTime={updatedAt}
                title={new Date(updatedAt).toLocaleString()}
                className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
              >
                {chatActivityLabel(updatedAt)}
              </time>
            )
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
          <span
            title={`${modelDescription}: ${selection.id ?? "unknown"}`}
            aria-label={`${modelDescription}: ${modelLabel}`}
            className={cn(
              "truncate text-foreground/75",
              !model && "text-muted-foreground"
            )}
          >
            {modelLabel}
          </span>
          {selection.source === "selected" && (
            <span className="shrink-0 text-[9px] text-muted-foreground">
              Selected
            </span>
          )}
          {running && (
            <span className="ml-auto shrink-0 text-[10px] font-medium text-success">
              Working
            </span>
          )}
          {!running && count > 0 && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {count} {count === 1 ? "message" : "messages"}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-[10px] leading-3.5 text-muted-foreground">
          <span
            title={thread?.projectPath || project}
            className="flex min-w-0 items-center gap-1"
          >
            <FolderIcon className="size-3" strokeWidth={1.5} />
            <span className="truncate">{project}</span>
          </span>
          {thread?.branch && (
            <span
              title={thread.branch}
              className="flex max-w-[50%] min-w-0 items-center gap-1 border-l border-border/60 pl-2"
            >
              <GitBranchIcon className="size-3" strokeWidth={1.5} />
              <span className="truncate">{thread.branch}</span>
            </span>
          )}
          {inSplit && (
            <span
              title="In chat stack"
              className="ml-auto flex shrink-0 items-center gap-1"
            >
              <Rows2Icon className="size-3" />
              Stack
            </span>
          )}
        </span>
      </span>
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md bg-popover text-muted-foreground opacity-0 shadow-sm transition-opacity duration-100 group-hover/chat-entry:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ")
              event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </CommandItem>
  )
}
