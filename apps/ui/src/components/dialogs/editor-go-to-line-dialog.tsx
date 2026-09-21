import { useEffect, useMemo, useState, type FormEvent } from "react"
import { LocateFixedIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { countEditorLines, parseGoToLineQuery } from "@/lib/editor-go-to-line"
import { useEditorStore } from "@/lib/editor-store"

interface EditorGoToLineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditorGoToLineDialog({
  open,
  onOpenChange,
}: EditorGoToLineDialogProps) {
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const activeTab = useEditorStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId)
  )
  const lineCount = useMemo(
    () => (activeTab ? countEditorLines(activeTab.content) : 1),
    [activeTab]
  )
  const target = useMemo(
    () =>
      parseGoToLineQuery(query, {
        currentLine: activeTab?.cursorLine,
        currentColumn: activeTab?.cursorColumn,
        maxLine: lineCount,
      }),
    [activeTab?.cursorColumn, activeTab?.cursorLine, lineCount, query]
  )

  useEffect(() => {
    if (!open) return
    setQuery("")
    setError(null)
  }, [open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeTab) return
    if (!target) {
      setError("Enter a line like 42, 42:7, +10, or -5.")
      return
    }

    useEditorStore.getState().recordNavigationPoint()
    window.dispatchEvent(
      new CustomEvent("betterc0de:editor-goto-line", {
        detail: {
          filePath: activeTab.filePath,
          line: target.line,
          column: target.column,
          preserveNavigation: true,
        },
      })
    )
    onOpenChange(false)
  }

  const placeholder = activeTab
    ? `${activeTab.cursorLine}:${activeTab.cursorColumn}`
    : "line:column"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[28%] max-w-md translate-y-0 overflow-hidden rounded-3xl p-0"
      >
        <DialogTitle className="sr-only">Go to Line</DialogTitle>
        <DialogDescription className="sr-only">
          Jump to a line and optional column in the active editor.
        </DialogDescription>

        <form onSubmit={handleSubmit}>
          <div className="border-b border-border/50 p-2">
            <div className="relative">
              <LocateFixedIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setError(null)
                }}
                autoFocus
                inputMode="text"
                placeholder={placeholder}
                disabled={!activeTab}
                className="h-10 rounded-2xl border-transparent bg-input/55 pr-3 pl-9 font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-3 px-4 py-4">
            {activeTab ? (
              <div>
                <p className="truncate text-sm font-medium">
                  {activeTab.fileName}
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {activeTab.filePath}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <Metric
                    label="Current"
                    value={`${activeTab.cursorLine}:${activeTab.cursorColumn}`}
                  />
                  <Metric label="Lines" value={String(lineCount)} />
                  <Metric
                    label="Target"
                    value={target ? `${target.line}:${target.column}` : "-"}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Open a file before jumping to a line.
              </p>
            )}

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use <code>line</code>, <code>line:column</code>, <code>+N</code>
                , or <code>-N</code>.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!activeTab}>
              Go
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/45 bg-muted/30 px-2 py-1.5">
      <div className="tracking-wide text-muted-foreground/70 uppercase">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-foreground">{value}</div>
    </div>
  )
}
