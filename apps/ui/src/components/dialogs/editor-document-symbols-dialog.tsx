import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import {
  BoxIcon,
  BracesIcon,
  Code2Icon,
  ComponentIcon,
  FileCode2Icon,
  FileSearchIcon,
  FunctionSquareIcon,
  HashIcon,
  KeyRoundIcon,
  ListTreeIcon,
  SearchIcon,
  VariableIcon,
  type LucideIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  buildCodeOutline,
  selectCurrentOutlinePath,
  type CodeOutlineItem,
  type CodeOutlineKind,
} from "@/lib/code-outline"
import { filterDocumentSymbols } from "@/lib/document-symbols"
import { useEditorStore } from "@/lib/editor-store"
import { cn } from "@/lib/utils"

interface EditorDocumentSymbolsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditorDocumentSymbolsDialog({
  open,
  onOpenChange,
}: EditorDocumentSymbolsDialogProps) {
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const activeTab = useEditorStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId)
  )
  const outline = useMemo(
    () =>
      activeTab
        ? buildCodeOutline({
            content: activeTab.content,
            language: activeTab.language,
            fileName: activeTab.fileName,
          })
        : [],
    [activeTab]
  )
  const currentOutlineIds = useMemo(
    () =>
      new Set(
        activeTab
          ? selectCurrentOutlinePath(outline, activeTab.cursorLine).map(
              (entry) => entry.id
            )
          : []
      ),
    [activeTab, outline]
  )
  const results = useMemo(
    () => filterDocumentSymbols(outline, query),
    [outline, query]
  )
  const selectedSymbol = results[selectedIndex] ?? null

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedIndex(0)
  }, [open])

  useEffect(() => {
    setSelectedIndex((index) => {
      if (results.length === 0) return 0
      return Math.min(index, results.length - 1)
    })
  }, [results.length])

  const jumpToSymbol = (entry: CodeOutlineItem) => {
    if (!activeTab) return
    useEditorStore.getState().recordNavigationPoint()
    window.dispatchEvent(
      new CustomEvent("betterc0de:editor-goto-line", {
        detail: {
          filePath: activeTab.filePath,
          line: entry.line,
          column: entry.column,
          preserveNavigation: true,
        },
      })
    )
    onOpenChange(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSelectedIndex((index) =>
        results.length === 0 ? 0 : (index + 1) % results.length
      )
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setSelectedIndex((index) =>
        results.length === 0 ? 0 : (index - 1 + results.length) % results.length
      )
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setSelectedIndex(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      setSelectedIndex(Math.max(0, results.length - 1))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      if (selectedSymbol) jumpToSymbol(selectedSymbol)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[24%] max-w-xl translate-y-0 overflow-hidden rounded-3xl p-0"
      >
        <DialogTitle className="sr-only">Go to Symbol in File</DialogTitle>
        <DialogDescription className="sr-only">
          Search symbols in the active editor file
        </DialogDescription>

        <div className="border-b border-border/50 p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              aria-activedescendant={
                selectedSymbol
                  ? documentSymbolDomId(selectedSymbol, selectedIndex)
                  : undefined
              }
              aria-controls="document-symbol-results"
              aria-autocomplete="list"
              autoFocus
              disabled={!activeTab}
              placeholder="Search symbols in the active file..."
              className="h-10 rounded-2xl border-transparent bg-input/55 pr-3 pl-9 text-sm"
            />
          </div>
        </div>

        <div className="border-b border-border/45 px-4 py-2">
          {activeTab ? (
            <div className="flex min-w-0 items-center gap-2">
              <FileCode2Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">
                  {activeTab.fileName}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {activeTab.language} - {outline.length} symbols
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ListTreeIcon className="size-4" />
              Open a file before searching document symbols.
            </div>
          )}
        </div>

        {!activeTab ? (
          <EmptyState icon={ListTreeIcon} text="No active file." />
        ) : outline.length === 0 ? (
          <EmptyState
            icon={HashIcon}
            text="No symbols were found in this file."
          />
        ) : results.length === 0 ? (
          <EmptyState icon={FileSearchIcon} text="No matching symbols." />
        ) : (
          <div
            id="document-symbol-results"
            className="max-h-[420px] overflow-y-auto p-1.5"
            role="listbox"
            aria-label="Document symbols"
          >
            {results.map((entry, index) => (
              <button
                id={documentSymbolDomId(entry, index)}
                key={entry.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => jumpToSymbol(entry)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-colors outline-none",
                  index === selectedIndex
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  currentOutlineIds.has(entry.id) && "ring-1 ring-primary/25"
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/55 text-muted-foreground",
                    documentSymbolIndentClass(entry.depth)
                  )}
                >
                  <DocumentSymbolIcon kind={entry.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {entry.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {entry.kind}
                    </span>
                  </span>
                  {entry.detail ? (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {entry.detail}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {entry.line}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-muted-foreground">
      <Icon className="size-6" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

const DOCUMENT_SYMBOL_INDENT_CLASSES = [
  "ml-0",
  "ml-2",
  "ml-4",
  "ml-6",
  "ml-8",
  "ml-10",
  "ml-12",
] as const

function documentSymbolIndentClass(depth: number): string {
  const index = Math.max(0, Math.min(6, Math.floor(depth)))
  return DOCUMENT_SYMBOL_INDENT_CLASSES[index] ?? "ml-0"
}

function documentSymbolDomId(entry: CodeOutlineItem, index: number): string {
  return `document-symbol-${index}-${entry.id.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

function DocumentSymbolIcon({ kind }: { kind: CodeOutlineKind }) {
  const Icon = iconForKind(kind)
  return <Icon className="size-3.5" strokeWidth={1.75} />
}

function iconForKind(kind: CodeOutlineKind): LucideIcon {
  switch (kind) {
    case "class":
      return BoxIcon
    case "component":
      return ComponentIcon
    case "function":
      return FunctionSquareIcon
    case "method":
      return Code2Icon
    case "type":
    case "interface":
    case "enum":
      return BracesIcon
    case "module":
      return FileCode2Icon
    case "selector":
      return HashIcon
    case "key":
      return KeyRoundIcon
    case "section":
      return ListTreeIcon
    default:
      return VariableIcon
  }
}
