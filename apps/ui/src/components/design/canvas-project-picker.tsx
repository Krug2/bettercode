import { useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  FolderPlusIcon,
  LayersIcon,
  MessageSquareIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { useChatStore } from "@/lib/chat-store"
import {
  hasNativeFolderPicker,
  openWorkspace,
  pickFolder,
} from "@/services/backend/runtime"
import { resolveNewThreadContext } from "@/lib/thread-context"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@/components/ui/command"
import { ChatSwitcherEntry } from "@/components/layout/chat-switcher-entry"
import { Input } from "@/components/ui/input"
import "./canvas-project-picker.css"

export function CanvasProjectPicker({
  open,
  onOpenChange,
  attachedIds,
  onAttach,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attachedIds: string[]
  onAttach: (threadId: string) => void
}) {
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const threads = useChatStore((state) => state.threads)
  const settings = useChatStore((state) => state.settingsByThread)
  const streaming = useChatStore((state) => state.streamingByThread)
  const nativeFolderPicker = hasNativeFolderPicker()
  const available = useMemo(
    () =>
      threads
        .filter((thread) => !attachedIds.includes(thread.id))
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ),
    [threads, attachedIds]
  )

  const changeOpen = (next: boolean) => {
    if (!next) {
      setQuery("")
      setError(null)
    }
    onOpenChange(next)
  }
  const attach = (id: string) => {
    onAttach(id)
    changeOpen(false)
  }
  const addFolder = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Both paths register the root with the backend before a chat can use it.
      const path = hasNativeFolderPicker()
        ? await pickFolder()
        : folder.trim()
          ? await openWorkspace(folder.trim())
          : null
      if (!path) return
      const context = resolveNewThreadContext({ selectedPath: path })
      const id = useChatStore
        .getState()
        .createThread("Canvas", context.projectName, context.projectPath)
      attach(id)
      setFolder("")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open this project"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="canvas-project-picker"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchRef.current?.focus()
        }}
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border/60 bg-background text-muted-foreground">
            <LayersIcon className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <DialogTitle className="text-[15px] font-semibold tracking-tight">
              Add to canvas
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Bring a repository or an existing chat into view.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <XIcon className="size-4" />
            </button>
          </DialogClose>
        </div>
        <div className="shrink-0 space-y-2 border-b border-border/50 px-4 pb-4">
          {!nativeFolderPicker && (
            <Input
              aria-label="Repository folder path"
              placeholder="Full path to a project folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addFolder()
              }}
              className="h-9 rounded-lg border-border/60 bg-background text-xs"
            />
          )}
          <button
            type="button"
            aria-label={busy ? "Opening project…" : "Open repository folder"}
            disabled={busy || (!nativeFolderPicker && !folder.trim())}
            onClick={() => void addFolder()}
            className="group/folder flex min-h-14 w-full items-center gap-3 rounded-[10px] border border-border/60 bg-background/60 px-3 py-2.5 text-left transition-colors duration-100 hover:border-muted-foreground/35 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <FolderPlusIcon
              className="size-[18px] shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">
                {busy ? "Opening project…" : "Open repository folder"}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {nativeFolderPicker
                  ? "Choose a project from your computer"
                  : "Create a canvas chat for this folder"}
              </span>
            </span>
            <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-100 group-hover/folder:translate-x-0.5" />
          </button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <Command className="canvas-picker-command">
          <div className="relative shrink-0 px-4 pt-3 pb-2">
            <CommandInput
              ref={searchRef}
              value={query}
              onValueChange={setQuery}
              aria-label="Find a canvas chat"
              placeholder="Search chats, projects or models…"
              className="pr-9 text-xs"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear chat search"
                className="absolute top-[18px] right-6 grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => {
                  setQuery("")
                  searchRef.current?.focus()
                }}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
          <CommandList className="canvas-picker-list">
            <CommandEmpty className="px-6 py-9">
              <SearchIcon
                className="mx-auto mb-3 size-5 text-muted-foreground/60"
                strokeWidth={1.5}
              />
              <p className="text-xs font-medium">
                {query ? "No matching chats" : "No other chats yet"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {query
                  ? "Try a project name, model or another search."
                  : "Open a repository folder to start a new project."}
              </p>
            </CommandEmpty>
            <CommandGroup
              heading={
                <span className="flex items-center justify-between gap-2">
                  <span>Existing chats</span>
                  <span className="font-normal tabular-nums">
                    {available.length} available
                  </span>
                </span>
              }
            >
              {available.map((thread) => (
                <ChatSwitcherEntry
                  key={thread.id}
                  thread={thread}
                  label={thread.title || "Untitled chat"}
                  selectedModel={settings[thread.id]?.selectedModel}
                  running={Boolean(
                    streaming[thread.id]?.isStreaming ||
                    thread.session?.activeTurnId
                  )}
                  onSelect={() => attach(thread.id)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/50 px-4 py-2.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MessageSquareIcon className="size-3" />
            Continue where you left off
          </span>
          <span className="hidden items-center gap-3 min-[420px]:flex">
            <span className="flex items-center gap-1">
              <ArrowUpIcon className="size-3" />
              <ArrowDownIcon className="size-3" />
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeftIcon className="size-3" />
              Add chat
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
