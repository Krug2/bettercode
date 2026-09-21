import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  useBackgroundComposerStore,
  type BackgroundTask,
} from "@/lib/background-composer-store"
import {
  PauseIcon, XIcon, ChevronDownIcon,
  CheckIcon, Loader2Icon, AlertCircleIcon,
  MinimizeIcon, MaximizeIcon, Trash2Icon,
  FileIcon, TerminalIcon, BrainIcon, GitBranchIcon,
} from "lucide-react"

function TaskStatusBadge({ status }: { status: BackgroundTask["status"] }) {
  const config: Record<BackgroundTask["status"], { label: string; color: string; icon: React.ReactNode }> = {
    queued: { label: "Queued", color: "text-muted-foreground bg-muted/50", icon: <PauseIcon className="size-3" /> },
    running: { label: "Running", color: "text-blue-400 bg-blue-500/10", icon: <Loader2Icon className="size-3 animate-spin" /> },
    paused: { label: "Paused", color: "text-amber-400 bg-amber-500/10", icon: <PauseIcon className="size-3" /> },
    completed: { label: "Completed", color: "text-emerald-400 bg-emerald-500/10", icon: <CheckIcon className="size-3" /> },
    failed: { label: "Failed", color: "text-red-400 bg-red-500/10", icon: <AlertCircleIcon className="size-3" /> },
    cancelled: { label: "Cancelled", color: "text-muted-foreground bg-muted/50", icon: <XIcon className="size-3" /> },
  }
  const c = config[status]
  return (
    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", c.color)}>
      {c.icon}
      {c.label}
    </span>
  )
}

function StepList({ steps }: { steps: BackgroundTask["steps"] }) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-0.5 py-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-0.5 text-[11px]">
          {step.status === "done" && <CheckIcon className="size-3 text-emerald-400 shrink-0" />}
          {step.status === "running" && <Loader2Icon className="size-3 text-blue-400 animate-spin shrink-0" />}
          {step.status === "pending" && <div className="size-3 rounded-full border border-border/50 shrink-0" />}
          {step.status === "error" && <AlertCircleIcon className="size-3 text-red-400 shrink-0" />}
          <span className={cn(
            "flex-1 truncate",
            step.status === "done" && "text-muted-foreground line-through",
            step.status === "running" && "text-foreground font-medium",
            step.status === "pending" && "text-muted-foreground",
            step.status === "error" && "text-red-400",
          )}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function TaskCard({ task }: { task: BackgroundTask }) {
  const [expanded, setExpanded] = useState(task.status === "running")
  const [showLogs, setShowLogs] = useState(false)
  const store = useBackgroundComposerStore

  const isTerminal = task.status === "completed" || task.status === "failed" || task.status === "cancelled"
  const elapsed = task.completedAt
    ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)
    : Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000)
  const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`

  return (
    <div className={cn(
      "rounded-lg border border-border/40 overflow-hidden transition-colors",
      task.status === "running" && "border-blue-500/30 bg-blue-500/3",
      task.status === "completed" && "border-emerald-500/20",
      task.status === "failed" && "border-red-500/20",
    )}>
      {/* Task header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        <ChevronDownIcon className={cn("size-3 text-muted-foreground/50 transition-transform shrink-0", !expanded && "-rotate-90")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate">{task.title}</span>
            <TaskStatusBadge status={task.status} />
          </div>
          {task.currentStep && task.status === "running" && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{task.currentStep}</p>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/50 shrink-0">{elapsedStr}</span>
      </button>

      {/* Progress bar */}
      {task.status === "running" && (
        <div className="h-0.5 bg-muted/30">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/20">
          {/* Steps */}
          <StepList steps={task.steps} />

          {/* Artifacts */}
          {task.artifacts.length > 0 && (
            <div className="border-t border-border/10 px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground font-medium mb-1">Artifacts ({task.artifacts.length})</p>
              <div className="space-y-0.5">
                {task.artifacts.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px]">
                    {a.type === "file" && <FileIcon className="size-3 text-muted-foreground/50" />}
                    {a.type === "command" && <TerminalIcon className="size-3 text-muted-foreground/50" />}
                    {a.type === "analysis" && <BrainIcon className="size-3 text-muted-foreground/50" />}
                    <span className="truncate">{a.path || a.content.slice(0, 60)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diffs summary */}
          {task.diffs.length > 0 && (
            <div className="border-t border-border/10 px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground font-medium mb-1">
                Changes ({task.diffs.length} files,{" "}
                <span className="text-emerald-400">+{task.diffs.reduce((s, d) => s + d.additions, 0)}</span>{" "}
                <span className="text-red-400">-{task.diffs.reduce((s, d) => s + d.deletions, 0)}</span>)
              </p>
              <div className="space-y-0.5">
                {task.diffs.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <FileIcon className="size-3 text-muted-foreground/50" />
                    <span className="truncate flex-1">{d.path}</span>
                    <span className="text-[10px] text-emerald-400">+{d.additions}</span>
                    <span className="text-[10px] text-red-400">-{d.deletions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branch info */}
          {task.branch && (
            <div className="border-t border-border/10 px-3 py-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <GitBranchIcon className="size-3" />
              <span className="font-mono">{task.branch}</span>
            </div>
          )}

          {/* Logs toggle */}
          {task.logs.length > 0 && (
            <div className="border-t border-border/10">
              <button
                type="button"
                onClick={() => setShowLogs(!showLogs)}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <TerminalIcon className="size-3" />
                Logs ({task.logs.length})
                <ChevronDownIcon className={cn("size-3 ml-auto transition-transform", !showLogs && "-rotate-90")} />
              </button>
              {showLogs && (
                <div className="max-h-[120px] overflow-y-auto bg-black/20 px-3 py-1 font-mono text-[10px] text-muted-foreground/70 leading-[1.6]">
                  {task.logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div className="border-t border-border/10 px-3 py-1.5 text-[11px] text-red-400 bg-red-500/5">
              {task.error}
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-border/10 flex items-center gap-1 px-3 py-1.5">
            {task.status === "running" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={() => store.getState().cancelTask(task.id)}
              >
                <XIcon className="size-3" /> Cancel
              </Button>
            )}
            {task.status === "completed" && task.diffs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={() => store.getState().applyChangesLocally(task.id)}
              >
                <CheckIcon className="size-3" /> Apply Changes
              </Button>
            )}
            {isTerminal && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 ml-auto text-muted-foreground"
                onClick={() => store.getState().removeTask(task.id)}
              >
                <Trash2Icon className="size-3" /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function BackgroundComposerPanel() {
  const tasks = useBackgroundComposerStore(s => s.tasks)
  const isMinimized = useBackgroundComposerStore(s => s.isMinimized)
  const setMinimized = useBackgroundComposerStore(s => s.setMinimized)

  const runningCount = tasks.filter(t => t.status === "running" || t.status === "queued").length

  if (tasks.length === 0) return null

  return (
    <div className={cn(
      "fixed bottom-4 right-4 z-50 w-[380px] rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden",
      "transition-all duration-200",
    )}>
      {/* Panel header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/20">
        <BrainIcon className="size-4 text-primary" />
        <span className="text-xs font-medium">Background Agents</span>
        {runningCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-400">
            <Loader2Icon className="size-3 animate-spin" />
            {runningCount} active
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setMinimized(!isMinimized)}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          {isMinimized ? <MaximizeIcon className="size-3" /> : <MinimizeIcon className="size-3" />}
        </button>
      </div>

      {/* Task list */}
      {!isMinimized && (
        <div className="max-h-[400px] overflow-y-auto p-2 space-y-2">
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}
