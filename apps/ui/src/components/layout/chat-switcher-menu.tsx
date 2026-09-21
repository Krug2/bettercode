import { useMemo, useState, type ComponentProps } from "react"
import {
  ChevronDownIcon,
  MessageSquareIcon,
  PlusIcon,
  RectangleHorizontalIcon,
  Rows2Icon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ChatSwitcherEntry } from "./chat-switcher-entry"
import { useChatStore } from "@/lib/chat-store"
import {
  buildChatHistory,
  chatTabLabel,
  orderOpenChats,
  threadHistoryTitle,
} from "@/lib/chat-switcher"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ComposerTabs } from "@/components/layout/composer-tabs"

type TabProps = ComponentProps<typeof ComposerTabs>

/**
 * The chat switcher for the editor-style workbench: one dropdown holding
 * the open chats and the history, in place of a horizontal tab strip that
 * ran out of room after four tabs and could not reach closed chats at all.
 *
 * Open chats act exactly like the tabs they replace (activate, close, show
 * in the stack); history rows go through the same `betterc0de:open-thread`
 * event the sidebar uses, so `use-composer-tabs` decides whether to reuse a
 * tab or add one. The trigger stays a single chip so the toolbar row keeps
 * one line whatever the count.
 */
export function ChatSwitcherMenu({
  composerTabs,
  activeComposerTab,
  setActiveComposerTab,
  closeComposerTab,
  splitTabIds,
  splitMode,
  maxSplit,
  enterSplitMode,
  exitSplitMode,
  addTabToSplit,
  removeTabFromSplit,
  addComposerTab,
  addSplitColumn,
  maxComposerTabs,
  projectPath,
}: TabProps & { projectPath?: string | null }) {
  const [open, setOpen] = useState(false)
  const threads = useChatStore((state) => state.threads)
  const settingsByThread = useChatStore((state) => state.settingsByThread)
  const streamingByThread = useChatStore((state) => state.streamingByThread)
  const threadById = (id: string | null) =>
    id ? threads.find((thread) => thread.id === id) : undefined
  // Listed by relevance, not by the order the tabs were opened: the chat the
  // user is in first, then the most recently active ones.
  const orderedTabs = orderOpenChats(composerTabs, {
    activeTabId: activeComposerTab,
    threadById,
  })

  const activeTab = composerTabs.find((tab) => tab.id === activeComposerTab)
  const activeLabel = activeTab
    ? chatTabLabel(activeTab, threadById(activeTab.threadId))
    : "Chat"
  const isInSplit = (tabId: string) => !!splitTabIds?.includes(tabId)

  const history = useMemo(
    () =>
      buildChatHistory({
        threads,
        openThreadIds: new Set(
          composerTabs.flatMap((tab) => (tab.threadId ? [tab.threadId] : []))
        ),
        projectPath,
      }),
    [threads, composerTabs, projectPath]
  )

  const activateTab = (tab: TabProps["composerTabs"][number]) => {
    if (tab.threadId && !threadById(tab.threadId)) return
    setActiveComposerTab(tab.id)
    if (tab.threadId) useChatStore.getState().setActiveThread(tab.threadId)
    setOpen(false)
  }
  const openFromHistory = (threadId: string, title: string) => {
    useChatStore.getState().setActiveThread(threadId)
    window.dispatchEvent(
      new CustomEvent("betterc0de:open-thread", {
        detail: { threadId, label: title },
      })
    )
    setOpen(false)
  }

  const modifier =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘"
      : "Ctrl "
  const canAddTab =
    !!addComposerTab &&
    composerTabs.length < (maxComposerTabs ?? Number.POSITIVE_INFINITY)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Switch chat"
            aria-haspopup="listbox"
            data-chat-switcher
            className="flex h-7 max-w-[min(100%,320px)] min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground/90 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <MessageSquareIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            <span className="truncate">{activeLabel}</span>
            {composerTabs.length > 1 && (
              <span className="shrink-0 rounded bg-muted/60 px-1 text-[10px] text-muted-foreground tabular-nums">
                {composerTabs.length}
              </span>
            )}
            <ChevronDownIcon
              className="size-3.5 shrink-0 text-muted-foreground/70"
              strokeWidth={2}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Chat history"
          className="max-h-[min(640px,var(--radix-popover-content-available-height))] w-[430px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-xl border border-border/60 bg-popover p-0 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.3)] ring-0"
        >
          <Command
            loop
            className="min-h-0 rounded-none bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:px-3 [&_[data-slot=command-input-wrapper]]:pt-0 [&_[data-slot=command-input-wrapper]]:pb-2 [&_[data-slot=input-group]]:h-9 [&_[data-slot=input-group]]:rounded-lg [&_[data-slot=input-group]]:border-border/50 [&_[data-slot=input-group]]:bg-background/60"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 px-3.5 pt-3 pb-2.5">
              <div>
                <h2 className="text-[13px] leading-5 font-semibold">Chats</h2>
                <p className="text-[10px] text-muted-foreground">
                  {composerTabs.length} open ·{" "}
                  {history.project.length + history.elsewhere.length} recent
                </p>
              </div>
              {addComposerTab && (
                <button
                  type="button"
                  aria-label="Start a new chat"
                  disabled={!canAddTab}
                  onClick={() => {
                    addComposerTab()
                    setOpen(false)
                  }}
                  className="flex h-7 items-center gap-1.5 rounded-md bg-foreground/8 px-2.5 text-[11px] font-medium transition-colors duration-100 hover:bg-foreground/12 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.96] disabled:opacity-40"
                >
                  <PlusIcon className="size-3.5" />
                  New chat
                  <span className="ml-1 text-[9px] text-muted-foreground">
                    {modifier}T
                  </span>
                </button>
              )}
            </div>
            <CommandInput
              aria-label="Search chat history"
              className="text-[12px]"
              placeholder="Search chats, models or projects…"
            />
            <CommandList
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "var(--border) transparent",
              }}
              className="max-h-[440px] min-h-0 flex-1 scroll-py-2 overflow-y-auto overscroll-contain px-1 pb-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-[10px]"
            >
              <CommandEmpty className="px-6 py-9 text-center">
                <MessageSquareIcon
                  className="mx-auto mb-2 size-6 text-muted-foreground/50"
                  strokeWidth={1.5}
                />
                <p className="text-[12px] font-medium">No matching chats</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Try a title, model, project or branch.
                </p>
              </CommandEmpty>
              <CommandGroup
                heading={
                  <HistoryGroupLabel
                    label="Open chats"
                    count={composerTabs.length}
                  />
                }
                className="p-1"
              >
                {orderedTabs.map((tab) => {
                  const thread = threadById(tab.threadId)
                  return (
                    <ChatSwitcherEntry
                      key={tab.id}
                      tabId={tab.id}
                      thread={thread}
                      label={chatTabLabel(tab, thread, 1000)}
                      selectedModel={
                        thread
                          ? settingsByThread[thread.id]?.selectedModel
                          : undefined
                      }
                      active={tab.id === activeComposerTab}
                      inSplit={isInSplit(tab.id)}
                      running={Boolean(
                        thread &&
                        (streamingByThread[thread.id]?.isStreaming ||
                          thread.session?.activeTurnId)
                      )}
                      unavailable={Boolean(tab.threadId && !thread)}
                      onSelect={() => activateTab(tab)}
                      onClose={() => closeComposerTab(tab.id)}
                    />
                  )
                })}
              </CommandGroup>
              {history.project.length > 0 && (
                <>
                  <CommandSeparator className="mx-2.5 my-1" />
                  <CommandGroup
                    heading={
                      <HistoryGroupLabel
                        label="Recent · this project"
                        count={history.project.length}
                      />
                    }
                    className="p-1"
                  >
                    {history.project.map((thread) => (
                      <ChatSwitcherEntry
                        key={thread.id}
                        thread={thread}
                        label={threadHistoryTitle(thread, 1000)}
                        selectedModel={
                          settingsByThread[thread.id]?.selectedModel
                        }
                        running={Boolean(
                          streamingByThread[thread.id]?.isStreaming ||
                          thread.session?.activeTurnId
                        )}
                        onSelect={() =>
                          openFromHistory(thread.id, threadHistoryTitle(thread))
                        }
                      />
                    ))}
                  </CommandGroup>
                </>
              )}
              {history.elsewhere.length > 0 && (
                <>
                  <CommandSeparator className="mx-2.5 my-1" />
                  <CommandGroup
                    heading={
                      <HistoryGroupLabel
                        label={
                          projectPath
                            ? "Recent · other projects"
                            : "Recent chats"
                        }
                        count={history.elsewhere.length}
                      />
                    }
                    className="p-1"
                  >
                    {history.elsewhere.map((thread) => (
                      <ChatSwitcherEntry
                        key={thread.id}
                        thread={thread}
                        label={threadHistoryTitle(thread, 1000)}
                        selectedModel={
                          settingsByThread[thread.id]?.selectedModel
                        }
                        running={Boolean(
                          streamingByThread[thread.id]?.isStreaming ||
                          thread.session?.activeTurnId
                        )}
                        onSelect={() =>
                          openFromHistory(thread.id, threadHistoryTitle(thread))
                        }
                      />
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
            <div className="flex shrink-0 items-center gap-3 border-t border-border/50 px-3.5 py-2 text-[10px] text-muted-foreground">
              <span>
                <kbd className="font-sans text-foreground/70">↑ ↓</kbd> Navigate
              </span>
              <span>
                <kbd className="font-sans text-foreground/70">↵</kbd> Open chat
              </span>
              <span className="ml-auto">
                <kbd className="font-sans text-foreground/70">Esc</kbd> Close
              </span>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      {addComposerTab && (
        <button
          type="button"
          onClick={addComposerTab}
          disabled={!canAddTab}
          title={`New chat (${modifier}T)`}
          aria-label="New chat"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40"
        >
          <PlusIcon aria-hidden className="size-4" />
        </button>
      )}

      {/* Stack layout menu — the same three actions the tab strip offered,
          plus per-chat stack membership for the active chat. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Chat layout"
            title="Chat layout"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              splitMode && "bg-muted/70 text-foreground"
            )}
          >
            <Rows2Icon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!splitMode} onSelect={exitSplitMode}>
            <RectangleHorizontalIcon />
            Single chat
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={splitMode || !enterSplitMode}
            onSelect={enterSplitMode}
          >
            <Rows2Icon />
            Stack chats
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={
              !activeTab ||
              !addTabToSplit ||
              isInSplit(activeComposerTab) ||
              (splitTabIds?.length ?? 0) >= (maxSplit ?? 12)
            }
            onSelect={() => {
              if (!splitMode) enterSplitMode?.()
              addTabToSplit?.(activeComposerTab)
            }}
          >
            <Rows2Icon />
            Show this chat in stack
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!isInSplit(activeComposerTab) || !removeTabFromSplit}
            onSelect={() => removeTabFromSplit?.(activeComposerTab)}
          >
            <Rows2Icon />
            Remove this chat from stack
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={
              !addSplitColumn ||
              !splitMode ||
              (splitTabIds?.length ?? 0) >=
                (maxSplit ?? Number.POSITIVE_INFINITY)
            }
            onSelect={addSplitColumn}
          >
            <PlusIcon />
            Add chat to stack
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function HistoryGroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="font-normal text-muted-foreground/70 tabular-nums">
        {count}
      </span>
    </span>
  )
}
