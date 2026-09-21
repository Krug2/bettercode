import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { WorkspaceContextArtifactResult } from "@betterc0de/schema"
import { AlertCircleIcon, FolderTreeIcon, RefreshCwIcon } from "lucide-react"
import { ContextSourceTree } from "@/components/chat/context-source-tree"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { usePromptInputController } from "@/components/ai-elements/prompt-input"
import { useThreadById } from "@/lib/chat-store"
import { formatTokens } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getContextArtifact } from "@/services/backend/workspaceApi"

interface ContextRequestState {
  key: string
  artifact: WorkspaceContextArtifactResult | null
  error: string | null
  loading: boolean
}

const INITIAL_REQUEST_STATE: ContextRequestState = {
  key: "",
  artifact: null,
  error: null,
  loading: false,
}

/**
 * Context-window meter and source inspector. The compact trigger retains the
 * existing composer footprint; opening it resolves the backend's authoritative
 * context artifact for this composer's thread.
 */
export function SimpleContextIndicator({
  threadId: ownerId,
  variant = "standalone",
}: {
  threadId: string | null
  variant?: "standalone" | "dropdown-item"
}) {
  const activeThread = useThreadById(ownerId)
  const promptInput = usePromptInputController()
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<ContextRequestState>(
    INITIAL_REQUEST_STATE
  )
  const requestSequence = useRef(0)

  const workspacePath =
    activeThread?.worktreePath?.trim() ||
    activeThread?.projectPath?.trim() ||
    ""
  const threadId = activeThread?.id ?? ""
  const pendingMessageCharacters = promptInput.textInput.value.length
  const pendingAttachments = useMemo(
    () =>
      promptInput.attachments.files.map((attachment) => ({
        id: attachment.id,
        name: attachment.filename?.trim() || "Attachment",
        mediaType: attachment.mediaType?.trim() || null,
        sizeBytes: null,
      })),
    [promptInput.attachments.files]
  )
  const contextKey = workspacePath ? `${workspacePath}\u0000${threadId}` : ""
  const currentRequest =
    request.key === contextKey ? request : INITIAL_REQUEST_STATE
  const artifact = currentRequest.artifact
  const usage = activeThread?.usage
  const usedTokens =
    artifact?.usedTokens ??
    usage?.usedTokens ??
    (usage?.inputTokens || 0) + (usage?.outputTokens || 0)
  const maxTokens = artifact?.maxTokens ?? usage?.maxTokens ?? 200_000
  const pct = maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : 0

  const loadContext = useCallback(async () => {
    if (!workspacePath) return
    const sequence = ++requestSequence.current
    setRequest((current) => ({
      key: contextKey,
      artifact: current.key === contextKey ? current.artifact : null,
      error: null,
      loading: true,
    }))

    try {
      const nextArtifact = await getContextArtifact(
        workspacePath,
        ".",
        threadId,
        {
          messageCharacters: pendingMessageCharacters,
          attachments: pendingAttachments,
        }
      )
      if (sequence !== requestSequence.current) return
      setRequest({
        key: contextKey,
        artifact: nextArtifact,
        error: null,
        loading: false,
      })
    } catch (error) {
      if (sequence !== requestSequence.current) return
      setRequest((current) => ({
        key: contextKey,
        artifact: current.key === contextKey ? current.artifact : null,
        error: describeContextError(error),
        loading: false,
      }))
    }
  }, [
    contextKey,
    pendingAttachments,
    pendingMessageCharacters,
    threadId,
    workspacePath,
  ])

  useEffect(() => {
    if (open && workspacePath && request.key !== contextKey) {
      void loadContext()
    }
  }, [contextKey, loadContext, open, request.key, workspacePath])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) void loadContext()
  }

  const ring = <ContextRing percentage={pct} />
  const trigger =
    variant === "dropdown-item" ? (
      <button
        type="button"
        aria-label="Inspect context sources"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-popover-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {ring}
        <span className="flex-1">Context Window</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
        </span>
      </button>
    ) : (
      <button
        type="button"
        aria-label="Inspect context sources"
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {ring}
        <span className="text-xs font-medium tabular-nums">
          {pct > 0 ? `${pct.toFixed(1)}%` : "0%"}
        </span>
      </button>
    )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={variant === "dropdown-item" ? "right" : "top"}
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="w-80 gap-0 overflow-hidden p-0 sm:w-96"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <p className="font-heading text-sm font-medium">Context sources</p>
            <p
              className="mt-0.5 truncate text-[10px] text-muted-foreground"
              title={workspacePath || undefined}
            >
              {workspacePath
                ? artifact?.targetPath === "."
                  ? activeThread?.projectName || workspacePath
                  : artifact?.targetPath || activeThread?.projectName
                : "No active workspace"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh context sources"
            disabled={!workspacePath || currentRequest.loading}
            onClick={() => void loadContext()}
          >
            <RefreshCwIcon
              className={cn(
                "size-3.5",
                currentRequest.loading && "animate-spin"
              )}
            />
          </Button>
        </div>

        <ContextUsageSummary
          artifact={artifact}
          usedTokens={usedTokens}
          maxTokens={maxTokens}
          percentage={pct}
        />

        {currentRequest.error && artifact ? (
          <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-[10px] text-destructive">
            <AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
            <p className="text-pretty">{currentRequest.error}</p>
          </div>
        ) : null}

        <ContextArtifactBody
          workspacePath={workspacePath}
          artifact={artifact}
          loading={currentRequest.loading}
          error={currentRequest.error}
          retry={loadContext}
        />
      </PopoverContent>
    </Popover>
  )
}

function ContextRing({ percentage }: { percentage: number }) {
  const radius = 9.75
  const circumference = 2 * Math.PI * radius
  return (
    <span className="relative flex size-5 shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="absolute inset-0 size-full -rotate-90"
      >
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-muted-foreground/20"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (percentage / 100) * circumference}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
    </span>
  )
}

function ContextUsageSummary({
  artifact,
  usedTokens,
  maxTokens,
  percentage,
}: {
  artifact: WorkspaceContextArtifactResult | null
  usedTokens: number
  maxTokens: number
  percentage: number
}) {
  return (
    <div className="space-y-3 border-b border-border/60 px-4 py-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium tabular-nums">
            {percentage.toFixed(1)}% used
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
          </span>
        </div>
        <Progress
          value={percentage}
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percentage)}
          className="h-1.5"
        />
      </div>

      <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/60 bg-muted/20">
        <ContextMetric
          label="Estimated"
          value={
            artifact ? formatTokens(artifact.estimatedTokens) : "Resolving"
          }
        />
        <ContextMetric
          label="Remaining"
          value={
            artifact?.remainingTokens === null || !artifact
              ? "Unknown"
              : formatTokens(artifact.remainingTokens)
          }
        />
        <ContextMetric
          label="Compaction"
          value={
            artifact?.compactsAutomatically === true
              ? "Automatic"
              : artifact?.compactsAutomatically === false
                ? "Manual"
                : "Unknown"
          }
        />
      </div>

      {artifact &&
      (artifact.compaction.generation > 0 ||
        artifact.compaction.excludedMessageCount > 0) ? (
        <p className="text-[10px] text-muted-foreground">
          Generation {artifact.compaction.generation} ·{" "}
          {artifact.compaction.excludedMessageCount} older{" "}
          {artifact.compaction.excludedMessageCount === 1
            ? "message"
            : "messages"}{" "}
          outside active context
        </p>
      ) : null}
    </div>
  )
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 py-2 text-center">
      <p className="truncate font-mono text-[10px] text-foreground">{value}</p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">{label}</p>
    </div>
  )
}

function ContextArtifactBody({
  workspacePath,
  artifact,
  loading,
  error,
  retry,
}: {
  workspacePath: string
  artifact: WorkspaceContextArtifactResult | null
  loading: boolean
  error: string | null
  retry: () => Promise<void>
}) {
  if (!workspacePath) {
    return (
      <ContextEmptyState
        title="Open a workspace"
        description="Context sources are resolved against the active project."
      />
    )
  }

  if (loading && !artifact) {
    return (
      <div
        role="status"
        className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground"
      >
        <Spinner className="size-4" />
        <p className="text-xs">Resolving context sources…</p>
      </div>
    )
  }

  if (error && !artifact) {
    return (
      <div role="alert" className="flex h-48 flex-col items-center px-8">
        <div className="my-auto space-y-3 text-center">
          <AlertCircleIcon className="mx-auto size-5 text-destructive" />
          <div>
            <p className="text-xs font-medium text-foreground">
              Context unavailable
            </p>
            <p className="mt-1 text-[10px] text-pretty text-muted-foreground">
              {error}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void retry()}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!artifact || artifact.sources.length === 0) {
    return (
      <ContextEmptyState
        title="No context sources"
        description="This thread has no rules, history, tools, or attachments to inspect."
      />
    )
  }

  return (
    <ScrollArea className="h-80">
      <ContextSourceTree
        sources={artifact.sources}
        workspaceRoot={artifact.workspaceRoot}
      />
    </ScrollArea>
  )
}

function ContextEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex h-48 flex-col items-center justify-center px-8 text-center">
      <FolderTreeIcon className="size-5 text-muted-foreground" />
      <p className="mt-2 text-xs font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[10px] text-pretty text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function describeContextError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "The context artifact could not be resolved."
}
