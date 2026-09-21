import { useEffect, useMemo, useRef, useState } from "react"
import {
  FileSearchIcon,
  FolderOpenIcon,
  Loader2Icon,
  SearchIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getFileIconUrl } from "@/lib/file-icons"
import { useEditorStore } from "@/lib/editor-store"
import {
  buildEditorQuickOpenItems,
  parseEditorQuickOpenQuery,
  type EditorQuickOpenItem,
} from "@/lib/editor-quick-open"
import { dispatchEditorGotoLine } from "@/lib/editor-go-to-line"
import { cn } from "@/lib/utils"
import {
  quickOpenFiles,
  type WorkspaceQuickOpenFile,
} from "@/services/backend/workspaceApi"

const QUICK_OPEN_LIMIT = 80

interface EditorQuickOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath?: string | null
  onOpenFolder: () => void
}

export function EditorQuickOpenDialog({
  open,
  onOpenChange,
  projectPath,
  onOpenFolder,
}: EditorQuickOpenDialogProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<WorkspaceQuickOpenFile[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeqRef = useRef(0)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const recentlyClosedTabs = useEditorStore((s) => s.recentlyClosedTabs)
  const recentFiles = useEditorStore((s) => s.recentFiles)
  const parsedQuery = useMemo(() => parseEditorQuickOpenQuery(query), [query])
  const displayItems = useMemo(
    () =>
      projectPath
        ? buildEditorQuickOpenItems({
            projectPath,
            query,
            workspaceFiles: results,
            tabs,
            activeTabId,
            recentlyClosedTabs,
            recentFiles,
            limit: QUICK_OPEN_LIMIT,
          })
        : [],
    [
      activeTabId,
      projectPath,
      query,
      recentFiles,
      recentlyClosedTabs,
      results,
      tabs,
    ]
  )

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedIndex(0)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!projectPath) {
      setResults([])
      setLoading(false)
      return
    }

    const requestId = requestSeqRef.current + 1
    requestSeqRef.current = requestId
    setLoading(true)
    setError(null)

    const timeout = window.setTimeout(
      () => {
        quickOpenFiles(projectPath, parsedQuery.searchQuery, QUICK_OPEN_LIMIT)
          .then((files) => {
            if (requestSeqRef.current !== requestId) return
            setResults(files)
            setSelectedIndex(0)
          })
          .catch((err) => {
            if (requestSeqRef.current !== requestId) return
            setResults([])
            setError(err instanceof Error ? err.message : String(err))
          })
          .finally(() => {
            if (requestSeqRef.current === requestId) setLoading(false)
          })
      },
      parsedQuery.searchQuery.trim() ? 120 : 0
    )

    return () => window.clearTimeout(timeout)
  }, [open, parsedQuery.searchQuery, projectPath])

  useEffect(() => {
    setSelectedIndex((index) =>
      displayItems.length === 0 ? 0 : Math.min(index, displayItems.length - 1)
    )
  }, [displayItems.length])

  const openItem = (item: EditorQuickOpenItem) => {
    if (!projectPath) return
    onOpenChange(false)
    void useEditorStore
      .getState()
      .openFile(item.filePath, {
        preview: item.source === "workspace",
        line: item.line,
        column: item.column,
      })
      .then(() => {
        if (!item.line) return
        dispatchEditorGotoLine(
          {
            filePath: item.filePath,
            line: item.line,
            column: item.column ?? 1,
            preserveNavigation: true,
          },
          { defer: true }
        )
      })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSelectedIndex((index) =>
        displayItems.length === 0
          ? 0
          : Math.min(displayItems.length - 1, index + 1)
      )
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const selected = displayItems[selectedIndex]
      if (selected) openItem(selected)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[24%] max-w-2xl translate-y-0 overflow-hidden rounded-3xl p-0"
      >
        <DialogTitle className="sr-only">Quick Open File</DialogTitle>
        <DialogDescription className="sr-only">
          Search and open files in the current workspace
        </DialogDescription>

        <div className="border-b border-border/50 p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              placeholder="Search files by name, path, or path:line..."
              className="h-10 rounded-2xl border-transparent bg-input/55 pr-10 pl-9 text-sm"
            />
            {loading && (
              <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {!projectPath ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <FolderOpenIcon className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">No workspace open</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open a folder before using quick file navigation.
              </p>
            </div>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                onOpenChange(false)
                onOpenFolder()
              }}
            >
              <FolderOpenIcon className="size-4" />
              Open Folder
            </Button>
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-sm text-destructive">
            {error}
          </div>
        ) : displayItems.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-muted-foreground">
            <FileSearchIcon className="size-6" />
            <p className="text-sm">
              {query.trim()
                ? "No matching editors or files."
                : "No editors or files found."}
            </p>
          </div>
        ) : (
          <div
            className="max-h-[420px] overflow-y-auto p-1.5"
            role="listbox"
            aria-label="Quick open editors and files"
          >
            {displayItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => openItem(item)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-colors outline-none",
                  index === selectedIndex
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                <img
                  src={getFileIconUrl(item.name)}
                  alt=""
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {item.relativePath}
                  </span>
                </span>
                <QuickOpenBadges item={item} />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function QuickOpenBadges({ item }: { item: EditorQuickOpenItem }) {
  const labels = [
    item.source === "active"
      ? "Active"
      : item.source === "open"
        ? "Open"
        : item.source === "recent"
          ? "Recent"
          : item.source === "history"
            ? "History"
            : null,
    item.isPinned ? "Pinned" : null,
    item.isDirty ? "Modified" : null,
    item.isPreview ? "Preview" : null,
  ].filter((label): label is string => Boolean(label))

  if (labels.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-[10px] leading-none",
            label === "Modified"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
              : "border-border/60 bg-background/60 text-muted-foreground"
          )}
        >
          {label}
        </span>
      ))}
    </span>
  )
}
