import { useEffect, useRef, useState } from "react"
import {
  XIcon,
  Rows2Icon,
  RectangleHorizontalIcon,
  PlusIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useChatStore, type ChatThread } from "@/lib/chat-store"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ComposerTab = {
  id: string
  threadId: string | null
  label: string
}

/**
 * Draggable chat tab strip. Tab chips with active indicator, optional
 * split badge on each tab, close button, reorder via HTML5 drag-and-drop,
 * and a right-click context menu for split actions. Sits as a `flex-1`
 * child inside a toolbar row that supplies the border/background.
 */
export function ComposerTabs({
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
  reorderTab,
  addComposerTab,
  addSplitColumn,
  maxComposerTabs,
}: {
  composerTabs: ComposerTab[]
  activeComposerTab: string
  setActiveComposerTab: (id: string) => void
  closeComposerTab: (id: string) => void
  splitTabIds?: string[] | null
  splitMode?: boolean
  maxSplit?: number
  enterSplitMode?: () => void
  exitSplitMode?: () => void
  addTabToSplit?: (tabId: string) => void
  removeTabFromSplit?: (tabId: string) => void
  reorderTab?: (fromId: string, toId: string) => void
  addComposerTab?: () => void
  addSplitColumn?: () => void
  maxComposerTabs?: number
}) {
  const activeTabRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    })
  }, [activeComposerTab])

  const modifier =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘"
      : "Ctrl "
  const [ctxMenu, setCtxMenu] = useState<{
    tabId: string
    x: number
    y: number
  } | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)

  // Subscribe to the full threads list so tab labels auto-update when a
  // chat gets a real title (e.g. first user message, rename, etc.).
  const threads = useChatStore((s) => s.threads)
  const threadById = (id: string | null): ChatThread | undefined =>
    id ? threads.find((t) => t.id === id) : undefined
  const tabDisplayLabel = (tab: ComposerTab): string => {
    const thread = threadById(tab.threadId)
    if (!thread) return tab.label
    // Prefer the first user message as a dynamic title (matches the way
    // the sidebar derives its titles). Falls back to the thread's own
    // title, then the tab's static label.
    const firstUser = thread.messages.find((m) => m.role === "user")
    if (firstUser?.content) {
      const trimmed = firstUser.content.trim().replace(/\s+/g, " ")
      if (trimmed.length > 0) {
        return trimmed.length > 28 ? trimmed.slice(0, 28) + "…" : trimmed
      }
    }
    if (thread.title && thread.title !== "New Chat") return thread.title
    return tab.label
  }

  const isInSplit = (tabId: string) =>
    !!(splitTabIds && splitTabIds.includes(tabId))

  const activateTab = (tab: ComposerTab) => {
    if (tab.threadId && !threadById(tab.threadId)) return
    setActiveComposerTab(tab.id)
    if (tab.threadId) {
      useChatStore.getState().setActiveThread(tab.threadId)
    }
  }

  return (
    <>
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Tabs — rounded chips, active = soft bg-muted pill. Matches the
            pane/panel/editor tab strips. The old full-height tab with a
            bg-primary top stripe rendered as a glaring white outline in this
            theme (primary is near-white in dark mode). */}
        <div
          role="tablist"
          aria-label="Open chats"
          className="flex w-max items-center gap-1 pr-1"
        >
          {composerTabs.map((tab, i) => {
            const active = activeComposerTab === tab.id
            const inSplit = isInSplit(tab.id)
            const unavailable = Boolean(
              tab.threadId && !threadById(tab.threadId)
            )
            return (
              <div
                key={tab.id}
                ref={active ? activeTabRef : undefined}
                data-chat-tab-id={tab.id}
                role="tab"
                aria-selected={active}
                aria-disabled={unavailable || undefined}
                tabIndex={active ? 0 : -1}
                aria-keyshortcuts={
                  i < 8
                    ? `${modifier === "Ctrl " ? "Control" : "Meta"}+${i + 1}`
                    : undefined
                }
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move"
                  e.dataTransfer.setData("application/betterc0de-tab", tab.id)
                  e.dataTransfer.setData("text/plain", tab.label)
                }}
                onDragOver={(e) => {
                  if (
                    !e.dataTransfer.types.includes("application/betterc0de-tab")
                  )
                    return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  setDragOverTab(tab.id)
                }}
                onDragLeave={() => {
                  setDragOverTab((prev) => (prev === tab.id ? null : prev))
                }}
                onDrop={(e) => {
                  const droppedId = e.dataTransfer.getData(
                    "application/betterc0de-tab"
                  )
                  setDragOverTab(null)
                  if (!droppedId || droppedId === tab.id) return
                  e.preventDefault()
                  reorderTab?.(droppedId, tab.id)
                }}
                onClick={() => activateTab(tab)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault()
                    const nextIndex =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? composerTabs.length - 1
                          : (i +
                              (e.key === "ArrowRight" ? 1 : -1) +
                              composerTabs.length) %
                            composerTabs.length
                    activateTab(composerTabs[nextIndex])
                    const tabs =
                      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                        '[role="tab"]'
                      )
                    tabs?.[nextIndex]?.focus()
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    activateTab(tab)
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    closeComposerTab(tab.id)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtxMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
                }}
                title={
                  unavailable
                    ? "Conversation unavailable in loaded history. Reopen it from history or close this tab."
                    : `${tabDisplayLabel(tab)}${i < 8 ? ` (${modifier}${i + 1})` : ""}`
                }
                className={cn(
                  "group relative flex h-8 max-w-[180px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2.5 text-xs transition-colors outline-none select-none",
                  "focus-visible:ring-1 focus-visible:ring-ring/25 focus-visible:ring-inset",
                  active
                    ? "bg-muted/70 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  inSplit && !active && "bg-muted/20 text-foreground/80",
                  dragOverTab === tab.id &&
                    "bg-primary/10 ring-1 ring-primary/60 ring-inset"
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {tabDisplayLabel(tab)}
                  {unavailable && " (unavailable)"}
                </span>

                {inSplit && (
                  <Rows2Icon
                    aria-hidden
                    className="size-3 shrink-0 text-primary/70"
                  />
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeComposerTab(tab.id)
                  }}
                  aria-label={`Close ${tabDisplayLabel(tab)}`}
                  tabIndex={active ? 0 : -1}
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/80 transition-[color,background-color,opacity] hover:bg-muted-foreground/20 hover:text-foreground",
                    active
                      ? "opacity-100"
                      : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  )}
                >
                  <XIcon aria-hidden className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {addComposerTab &&
        composerTabs.length < (maxComposerTabs ?? Infinity) && (
          <button
            type="button"
            onClick={addComposerTab}
            onContextMenu={(e) => {
              e.preventDefault()
              addComposerTab()
            }}
            title={`New chat (${modifier}T)`}
            aria-label="New chat"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <PlusIcon aria-hidden className="size-4" />
          </button>
        )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Chat layout"
            title="Chat layout"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              splitMode && "bg-muted/70 text-foreground"
            )}
          >
            <Rows2Icon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!splitMode} onSelect={exitSplitMode}>
            <RectangleHorizontalIcon />
            Show one chat
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={splitMode || !enterSplitMode}
            onSelect={enterSplitMode}
          >
            <Rows2Icon />
            Stack chats vertically
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={
              !addSplitColumn ||
              composerTabs.length >= (maxComposerTabs ?? Infinity) ||
              (splitTabIds?.length ?? 0) >= (maxSplit ?? Infinity)
            }
            onSelect={addSplitColumn}
          >
            <PlusIcon />
            Add chat panel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {ctxMenu && (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) setCtxMenu(null)
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Chat actions"
              className="pointer-events-none fixed size-px opacity-0"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={0}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const tabs = Array.from(
                document.querySelectorAll<HTMLElement>("[data-chat-tab-id]")
              )
              const target =
                tabs.find((tab) => tab.dataset.chatTabId === ctxMenu.tabId) ??
                tabs.find((tab) => tab.getAttribute("aria-selected") === "true")
              target?.focus()
            }}
          >
            <DropdownMenuItem
              disabled={
                isInSplit(ctxMenu.tabId) ||
                (splitTabIds?.length ?? 0) >= (maxSplit ?? 12) ||
                !addTabToSplit
              }
              onSelect={() => {
                if (!splitMode) enterSplitMode?.()
                addTabToSplit?.(ctxMenu.tabId)
                setCtxMenu(null)
              }}
            >
              <Rows2Icon />
              Show in chat stack
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!isInSplit(ctxMenu.tabId) || !removeTabFromSplit}
              onSelect={() => {
                removeTabFromSplit?.(ctxMenu.tabId)
                setCtxMenu(null)
              }}
            >
              <Rows2Icon />
              Remove from chat stack
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                closeComposerTab(ctxMenu.tabId)
                setCtxMenu(null)
              }}
            >
              <XIcon />
              Close tab
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
