import { copyText } from "@/lib/clipboard"
import { buildConsoleReport } from "@/lib/console-report"
import type { ConsoleLog } from "@/hooks/use-console-capture"
import { useBugReportStore } from "@/services/bug-report"
import { ConsoleMessage } from "./console-message"
import {
  AlertCircleIcon,
  CopyIcon,
  FileTextIcon,
  LoaderCircleIcon,
  SendIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ActiveThreadRef = {
  title?: string
  projectPath?: string | null
}

/**
 * Bottom-anchored developer console panel — shown when
 * `consolePanelOpen` is true (toggled from the titlebar console icon).
 *
 * Two tabs share the same header:
 *  - **Console**: live log stream, colored by severity, with `Clear` and
 *    `Copy Logs` affordances.
 *  - **Report**: structured session snapshot (thread, project, model,
 *    message count, log counts) plus pre-formatted blocks for errors
 *    and warnings — designed to be pasted into bug reports / Github
 *    issues with a single `Copy Report` click, or sent directly to support.
 *
 * The top edge of the panel is a resize handle that drags the `height`
 * between 150 and 500 px.
 */
export function ConsolePanel({
  consolePanelHeight,
  setConsolePanelHeight,
  consolePanelOpen: _open,
  setConsolePanelOpen,
  consoleTab,
  setConsoleTab,
  consoleLogs,
  setConsoleLogs,
  activeThread,
  selectedModel,
  messageCount,
}: {
  consolePanelHeight: number
  setConsolePanelHeight: (h: number) => void
  consolePanelOpen: boolean
  setConsolePanelOpen: (open: boolean) => void
  consoleTab: "console" | "report"
  setConsoleTab: (tab: "console" | "report") => void
  consoleLogs: ConsoleLog[]
  setConsoleLogs: (logs: ConsoleLog[]) => void
  activeThread: ActiveThreadRef | null
  selectedModel: string | null
  messageCount: number
}) {
  const { pending, cooldownSeconds, feedback, send } = useBugReportStore()
  const reportSnapshot = () => buildConsoleReport({ consoleLogs, activeThread, selectedModel, messageCount })

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border/40 bg-background"
      style={{ height: consolePanelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize bg-transparent transition-colors hover:bg-primary/30"
        onMouseDown={(e) => {
          e.preventDefault()
          const startY = e.clientY
          const startH = consolePanelHeight
          const onMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY
            setConsolePanelHeight(Math.min(500, Math.max(150, startH + delta)))
          }
          const onUp = () => {
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
          }
          document.addEventListener("mousemove", onMove)
          document.addEventListener("mouseup", onUp)
        }}
      />
      {/* Header with tabs */}
      <div className="flex h-[32px] items-center border-b border-border bg-sidebar">
        <button
          type="button"
          onClick={() => setConsoleTab("console")}
          className={cn(
            "flex h-full items-center gap-1.5 border-b-2 px-3 text-[11px] transition-colors",
            consoleTab === "console"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground/80"
          )}
        >
          <TerminalIcon className="size-3" />
          Console
        </button>
        <button
          type="button"
          onClick={() => setConsoleTab("report")}
          className={cn(
            "flex h-full items-center gap-1.5 border-b-2 px-3 text-[11px] transition-colors",
            consoleTab === "report"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground/80"
          )}
        >
          <FileTextIcon className="size-3" />
          Report
        </button>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Copy all console logs"
              onClick={() => {
                const text = consoleLogs
                  .map(
                    (l) =>
                      `[${l.timestamp.toLocaleTimeString()}] [${l.type.toUpperCase()}] ${l.message}`
                  )
                  .join("\n")
                copyText(text)
              }}
              className="flex h-full items-center px-2 text-muted-foreground/70 transition-colors hover:text-foreground/80"
            >
              <CopyIcon className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy Logs</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setConsoleLogs([])}
              className="flex h-full items-center px-2 text-muted-foreground/70 transition-colors hover:text-foreground/80"
            >
              <Trash2Icon className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Clear</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={() => setConsolePanelOpen(false)}
          className="flex h-full items-center px-2 text-muted-foreground/70 transition-colors hover:text-foreground/80"
        >
          <XIcon className="size-3" />
        </button>
      </div>
      {/* Content */}
      <div className="min-h-0 flex-1 select-text overflow-y-auto">
        {consoleTab === "console" ? (
          <div className="space-y-0.5 p-2 font-mono text-[11px]">
            {consoleLogs.length === 0 ? (
              <p className="px-2 py-4 text-center text-muted-foreground/70">
                No console output
              </p>
            ) : (
              consoleLogs.map((log, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 rounded px-2 py-0.5",
                    log.type === "error" && "bg-red-500/10 text-red-400",
                    log.type === "warn" && "bg-yellow-500/10 text-yellow-400",
                    log.type === "info" && "text-blue-400",
                    log.type === "debug" && "text-muted-foreground",
                    log.type === "log" && "text-foreground/90"
                  )}
                >
                  <span className="shrink-0 text-muted-foreground/70">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <ConsoleMessage text={log.message} copyValue={`[${log.timestamp.toISOString()}] [${log.type.toUpperCase()}] ${log.message}`} />
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <FileTextIcon className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Console Report</span>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1.5 text-[10px]"
                onClick={() => {
                  const report = reportSnapshot()
                  copyText(report.message + (report.stack ? `\n\n### Stack traces\n${report.stack}` : ""))
                }}
              >
                <CopyIcon className="size-3" />
                Copy Report
              </Button>
              <Button
                size="sm"
                className="h-6 min-w-24 gap-1.5 text-[10px]"
                disabled={pending || cooldownSeconds > 0}
                aria-busy={pending}
                onClick={() => void send(reportSnapshot())}
              >
                {pending ? <LoaderCircleIcon className="size-3 animate-spin" /> : <SendIcon className="size-3" />}
                {pending ? "Sending…" : cooldownSeconds > 0 ? `Send in ${cooldownSeconds}s` : "Send Report"}
              </Button>
            </div>
            {feedback && (
              <p role="status" className={cn("text-[11px]", feedback.ok ? "text-muted-foreground" : "text-red-400")}>
                {feedback.message}
              </p>
            )}
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Messages</span>
                <span className="font-mono text-foreground/90">
                  {messageCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Thread</span>
                <span className="max-w-[200px] truncate font-mono text-foreground/90">
                  {activeThread?.title || "No thread"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Project</span>
                <span className="max-w-[200px] truncate font-mono text-foreground/90">
                  {activeThread?.projectPath?.split(/[/\\]/).pop() || "None"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-foreground/90">
                  {selectedModel || "None"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Total Logs</span>
                <span className="font-mono text-foreground/90">
                  {consoleLogs.length}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Errors</span>
                <span
                  className={cn(
                    "font-mono",
                    consoleLogs.filter((l) => l.type === "error").length > 0
                      ? "text-red-400"
                      : "text-foreground/90"
                  )}
                >
                  {consoleLogs.filter((l) => l.type === "error").length}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Warnings</span>
                <span
                  className={cn(
                    "font-mono",
                    consoleLogs.filter((l) => l.type === "warn").length > 0
                      ? "text-yellow-400"
                      : "text-foreground/90"
                  )}
                >
                  {consoleLogs.filter((l) => l.type === "warn").length}
                </span>
              </div>
            </div>
            {consoleLogs.filter((l) => l.type === "error").length > 0 && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-red-400">
                  <AlertCircleIcon className="size-3.5" />
                  <span>
                    Errors (
                    {consoleLogs.filter((l) => l.type === "error").length})
                  </span>
                </div>
                <div className="max-h-[120px] space-y-1 overflow-y-auto font-mono text-[11px] text-red-300/80">
                  {consoleLogs
                    .filter((l) => l.type === "error")
                    .map((log, i) => (
                      <ConsoleMessage key={i} text={log.message} copyValue={`[${log.timestamp.toISOString()}] [ERROR] ${log.message}`} />
                    ))}
                </div>
              </div>
            )}
            {consoleLogs.filter((l) => l.type === "warn").length > 0 && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-yellow-400">
                  <AlertCircleIcon className="size-3.5" />
                  <span>
                    Warnings (
                    {consoleLogs.filter((l) => l.type === "warn").length})
                  </span>
                </div>
                <div className="max-h-[80px] space-y-1 overflow-y-auto font-mono text-[11px] text-yellow-300/80">
                  {consoleLogs
                    .filter((l) => l.type === "warn")
                    .map((log, i) => (
                      <ConsoleMessage key={i} text={log.message} copyValue={`[${log.timestamp.toISOString()}] [WARN] ${log.message}`} />
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
