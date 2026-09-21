import { useEffect, useMemo, useRef, useState } from "react"
import {
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  LayersIcon,
  ServerIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { AgentActivityOrb, agentActivityPillClassName } from "@/components/ai-elements/agent-activity"
import type { OrbState } from "thinking-orbs"
import {
  ToolCallItem,
  formatDuration,
  shouldExpandToolCallByDefault,
  type ToolCallData,
} from "@/components/chat/tool-call-item"
import {
  describeProviderToolActivity,
  type ToolActivityDescription,
  type ToolAction,
} from "@betterc0de/schema/tool-activity"
import { formatProviderActivityLabel } from "@/lib/provider-label"
import { builtinProviders } from "@/lib/builtin-providers"
import { logoNeedsDarkInvert } from "@/lib/logo-invert"
import { buildToolCallTree, type ToolCallTreeNode } from "@/lib/tool-call-tree"
import {
  foldRepeatedToolRuns,
  foldedRunLabel,
} from "@/lib/tool-run-folding"

import { ExecutionFailure } from "./execution-failure"

const TOOL_ACTIVITY_ORB = {
  command: "working",
  read: "working",
  file_change: "shaping",
  search: "searching",
  list: "searching",
  other: "working",
} satisfies Record<ToolAction, OrbState>

export type ToolCallGroupWorkEntry = {
  id: string
  label: string
  detail?: string
  diagnostics?: string
  providerKind?: string
  providerInstanceId?: string
  providerLabel?: string
  kind: string
  tone: "thinking" | "tool" | "info" | "approval" | "error"
  createdAt: string
  sessionId?: string
  taskId?: string
  parentTaskId?: string
  agentId?: string
  parentAgentId?: string
  parentToolId?: string
}

type GroupItem =
  | { type: "tool"; sortKey: string; order: number; tool: ToolCallData }
  | {
      type: "work"
      sortKey: string
      order: number
      work: ToolCallGroupWorkEntry
    }

/**
 * Collapses a turn's tool calls + work events (hooks, diffs, task progress)
 * into one slim dropdown line — "N steps · 12s" — instead of a stack of
 * full-width cards. Styled after the AI Elements Reasoning trigger so the
 * transcript reads as prose with quiet, expandable machinery between
 * messages.
 *
 * Open/close animates via the shared Radix collapsible keyframes
 * (`betterc0de-collapsible-content`); rows stagger-fade into place on open.
 * While streaming the trigger auto-opens and animates with the live label of
 * the currently running tool; a manual toggle always wins over auto-open.
 *
 * The provider badge renders once in the header when the whole group shares
 * one provider, and falls back to per-row badges for mixed-provider turns.
 */
export function ToolCallGroup({
  tools,
  work = [],
  streaming = false,
  defaultOpen = false,
  showGenericOutput = false,
  shellToolPartsExpanded = false,
  editToolPartsExpanded = false,
  workspaceRoot,
  treeKey,
  className,
}: {
  tools: ToolCallData[]
  work?: ToolCallGroupWorkEntry[]
  streaming?: boolean
  defaultOpen?: boolean
  showGenericOutput?: boolean
  shellToolPartsExpanded?: boolean
  editToolPartsExpanded?: boolean
  workspaceRoot?: string | null
  treeKey?: string
  className?: string
}) {
  const items = useMemo(() => mergeGroupItems(tools, work), [tools, work])
  const tree = useMemo(() => buildGroupTree(items), [items])
  // A long turn produces hundreds of rows — forty searches, a dozen reads,
  // forty searches again — which pushes the informative ones off screen.
  // Adjacent rows with the same action fold into one countable row whose
  // label spells out what differed (the files, patterns or commands), and
  // that still expands to the originals. Rows with children never fold.
  const foldedTree = useMemo(
    () =>
      foldRepeatedToolRuns(tree, (node) => ({
        id: node.id,
        kind: node.kind,
        ...toolRowFoldKey(node),
        hasChildren: node.children.length > 0,
      })),
    [tree]
  )
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() =>
    readCollapsedNodes(treeKey)
  )
  const resolvedDefaultOpen =
    defaultOpen ||
    tools.some((tool) =>
      shouldExpandToolCallByDefault({
        toolName: tool.name,
        shellToolPartsExpanded,
        editToolPartsExpanded,
      })
    )

  const [open, setOpen] = useState(resolvedDefaultOpen || streaming)
  const userToggledRef = useRef(false)
  useEffect(() => {
    if (!userToggledRef.current) setOpen(resolvedDefaultOpen || streaming)
  }, [resolvedDefaultOpen, streaming])

  if (items.length === 0) return null

  const failedCount =
    tools.filter((tool) => isToolFailed(tool)).length +
    work.filter((entry) => entry.tone === "error").length
  const runningTool = streaming ? tools.findLast((tool) => !isToolDone(tool)) : undefined
  const isWorking = runningTool !== undefined
  const durationMs = groupDurationMs(tools, work)
  const durationLabel =
    !isWorking && typeof durationMs === "number" && durationMs > 0
      ? formatDuration(durationMs)
      : ""
  const sharedProviderLabel = uniqueProviderLabel(tools, work)
  const sharedProviderLogo = sharedProviderLabel
    ? builtinProviders.find(provider => formatProviderActivityLabel({ providerKind: provider.providerKind }) === sharedProviderLabel.split(" / ")[0])?.logo
    : undefined
  const lastToolId = tools.at(-1)?.id

  const stepLabel = `${items.length} ${items.length === 1 ? "step" : "steps"}`
  const liveLabel = runningTool ? buildLiveLabel(runningTool) : ""
  const orbState = runningTool ? TOOL_ACTIVITY_ORB[describeTool(runningTool).action] : "working"

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        userToggledRef.current = true
        setOpen(next)
      }}
      // No bottom margin: the transcript column already owns the vertical
      // rhythm via its `gap`. Carrying an own `mb-3` on top of that stacked
      // two spacings between a tool group and the text under it.
      className={cn("not-prose", className)}
    >
      <CollapsibleTrigger className={cn(
        "flex w-full min-h-7 items-center gap-2 rounded-md py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground",
        isWorking && cn(agentActivityPillClassName, "min-h-10"),
      )}>
        {isWorking ? (
          <AgentActivityOrb state={orbState} />
        ) : failedCount > 0 ? (
          <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
        ) : sharedProviderLogo ? (
          <img src={sharedProviderLogo} alt="" className={cn("size-3.5 shrink-0 object-contain", logoNeedsDarkInvert(sharedProviderLogo) && "dark:invert")} />
        ) : (
          <WrenchIcon className="size-3.5 shrink-0" />
        )}
        {sharedProviderLabel && (
          <span
            title={sharedProviderLabel}
            className="max-w-[180px] shrink-0 truncate"
          >
            {sharedProviderLabel}
          </span>
        )}
        {isWorking ? (
          <span className="agent-activity-text min-w-0 truncate">
            {liveLabel}
          </span>
        ) : (
          <span className="font-medium">{stepLabel}</span>
        )}
        {durationLabel && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {durationLabel}
          </span>
        )}
        {failedCount > 0 && !isWorking && (
          <span className="text-[10px] font-medium text-destructive">
            {failedCount} failed
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="betterc0de-collapsible-content">
        <div className="mt-1.5 ml-[11px] flex flex-col gap-px border-l border-border/40 pl-2">
          {foldedTree.map((entry) =>
            entry.type === "run" ? (
              <FoldedToolRun
                key={entry.id}
                label={foldedRunLabel(
                  entry.signature,
                  entry.nodes.length,
                  entry.details
                )}
                count={entry.nodes.length}
              >
                {entry.nodes.map((node) => (
                  <ToolTreeNodeRow
                    key={node.id}
                    node={node}
                    collapsedNodeIds={collapsedNodeIds}
                    onToggle={(nodeId) => {
                      setCollapsedNodeIds((current) => {
                        const next = new Set(current)
                        if (next.has(nodeId)) next.delete(nodeId)
                        else next.add(nodeId)
                        writeCollapsedNodes(treeKey, next)
                        return next
                      })
                    }}
                    defaultOpen={defaultOpen}
                    streaming={streaming}
                    isWorking={isWorking}
                    lastToolId={lastToolId}
                    showGenericOutput={showGenericOutput}
                    shellToolPartsExpanded={shellToolPartsExpanded}
                    editToolPartsExpanded={editToolPartsExpanded}
                    showProviderBadge={!sharedProviderLabel}
                    workspaceRoot={workspaceRoot}
                  />
                ))}
              </FoldedToolRun>
            ) : (
            <ToolTreeNodeRow
              key={entry.node.id}
              node={entry.node}
              collapsedNodeIds={collapsedNodeIds}
              onToggle={(nodeId) => {
                setCollapsedNodeIds((current) => {
                  const next = new Set(current)
                  if (next.has(nodeId)) next.delete(nodeId)
                  else next.add(nodeId)
                  writeCollapsedNodes(treeKey, next)
                  return next
                })
              }}
              defaultOpen={defaultOpen}
              streaming={streaming}
              isWorking={isWorking}
              lastToolId={lastToolId}
              showGenericOutput={showGenericOutput}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              showProviderBadge={!sharedProviderLabel}
              workspaceRoot={workspaceRoot}
            />
            )
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * One row standing in for a run of same-action rows, e.g.
 * "Read file ×6 · a.ts, b.ts, c.ts, +3". Collapsed by default — the label
 * already says what the run touched — but every original row is still one
 * click away.
 */
function FoldedToolRun({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted/40 hover:text-foreground"
      >
        <LayersIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
          {count}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="ml-[11px] flex flex-col gap-px border-l border-border/40 pl-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

type GroupTreeNode = ToolCallTreeNode<ToolCallData, ToolCallGroupWorkEntry>

function ToolTreeNodeRow({
  node,
  collapsedNodeIds,
  onToggle,
  defaultOpen,
  streaming,
  isWorking,
  lastToolId,
  showGenericOutput,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  showProviderBadge,
  workspaceRoot,
}: {
  node: GroupTreeNode
  collapsedNodeIds: ReadonlySet<string>
  onToggle: (nodeId: string) => void
  defaultOpen: boolean
  streaming: boolean
  isWorking: boolean
  lastToolId?: string
  showGenericOutput: boolean
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  showProviderBadge: boolean
  workspaceRoot?: string | null
}) {
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && !collapsedNodeIds.has(node.id)
  const toggle = hasChildren ? (
    <button
      type="button"
      className="mt-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={expanded ? "Collapse nested steps" : "Expand nested steps"}
      aria-expanded={expanded}
      onClick={() => onToggle(node.id)}
    >
      {expanded ? (
        <ChevronDownIcon className="size-3" />
      ) : (
        <ChevronRightIcon className="size-3" />
      )}
    </button>
  ) : null

  return (
    <div className="betterc0de-tool-row">
      <div className="flex min-w-0 items-start gap-0.5">
        {toggle}
        <div className="min-w-0 flex-1">
          {node.kind === "tool" && node.value ? (
            <ToolCallItem
              tc={node.value as ToolCallData}
              defaultOpen={
                defaultOpen ||
                (streaming &&
                  isWorking &&
                  (node.value as ToolCallData).id === lastToolId)
              }
              streaming={streaming}
              showGenericOutput={showGenericOutput}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              showProviderBadge={showProviderBadge}
              workspaceRoot={workspaceRoot}
            />
          ) : node.kind === "work" && node.value ? (
            <WorkEntryRow
              entry={node.value as ToolCallGroupWorkEntry}
              showProviderBadge={showProviderBadge}
            />
          ) : (
            <CorrelationNodeRow node={node} />
          )}
        </div>
      </div>
      {expanded ? (
        <div className="ml-2.5 border-l border-border/40 pl-2">
          {node.children.map((child) => (
            <ToolTreeNodeRow
              key={child.id}
              node={child}
              collapsedNodeIds={collapsedNodeIds}
              onToggle={onToggle}
              defaultOpen={defaultOpen}
              streaming={streaming}
              isWorking={isWorking}
              lastToolId={lastToolId}
              showGenericOutput={showGenericOutput}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              showProviderBadge={showProviderBadge}
              workspaceRoot={workspaceRoot}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CorrelationNodeRow({ node }: { node: GroupTreeNode }) {
  const Icon =
    node.kind === "session"
      ? ServerIcon
      : node.kind === "agent"
        ? BrainIcon
        : WrenchIcon
  const prefix =
    node.kind === "session"
      ? "Session"
      : node.kind === "agent"
        ? "Agent"
        : "Task"
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground">
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="shrink-0 font-medium text-foreground/80">{prefix}</span>
      <span className="min-w-0 truncate">{node.label}</span>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
        {node.children.length} {node.children.length === 1 ? "step" : "steps"}
      </span>
    </div>
  )
}

function WorkEntryRow({
  entry,
  showProviderBadge,
}: {
  entry: ToolCallGroupWorkEntry
  showProviderBadge: boolean
}) {
  if (entry.tone === "error") {
    return (
      <ExecutionFailure
        title={showProviderBadge && entry.providerLabel
          ? `${entry.providerLabel} · ${entry.label}`
          : entry.label}
        message={entry.detail || "No further error details were supplied."}
        details={entry.diagnostics}
        context={entry.providerLabel}
      />
    )
  }
  const isCompletion =
    entry.kind === "task.completed" ||
    entry.kind.endsWith(".completed") ||
    entry.kind === "files.persisted"
  const Icon = isCompletion ? CircleCheckIcon : BrainIcon
  return (
    <div
      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground"
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0 opacity-70",
          isCompletion && "text-success opacity-100"
        )}
      />
      {showProviderBadge && entry.providerLabel && (
        <span
          title={entry.providerLabel}
          className="max-w-[120px] shrink-0 truncate rounded bg-muted px-1 py-px text-[9px] font-medium"
        >
          {entry.providerLabel}
        </span>
      )}
      <span className="min-w-0 truncate">{entry.label}</span>
      {entry.detail && (
        <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground/60 sm:inline">
          {entry.detail}
        </span>
      )}
    </div>
  )
}

/** Interleave tools and work entries chronologically; items without a
 * timestamp keep their insertion order (streaming tools have no startedAt). */
function mergeGroupItems(
  tools: ToolCallData[],
  work: ToolCallGroupWorkEntry[]
): GroupItem[] {
  const items: GroupItem[] = [
    ...tools.map((tool, i) => ({
      type: "tool" as const,
      sortKey: tool.startedAt ?? "",
      order: i,
      tool,
    })),
    ...work.map((entry, i) => ({
      type: "work" as const,
      sortKey: entry.createdAt,
      order: tools.length + i,
      work: entry,
    })),
  ]
  return items.sort((a, b) => {
    if (a.sortKey && b.sortKey && a.sortKey !== b.sortKey) {
      return a.sortKey.localeCompare(b.sortKey)
    }
    return a.order - b.order
  })
}

function buildGroupTree(items: GroupItem[]): GroupTreeNode[] {
  return buildToolCallTree<ToolCallData, ToolCallGroupWorkEntry>(
    items.map((item) =>
      item.type === "tool"
        ? {
            kind: "tool" as const,
            id: item.tool.id,
            sortKey: item.sortKey,
            order: item.order,
            correlation: correlationFor(item.tool),
            value: item.tool,
          }
        : {
            kind: "work" as const,
            id: item.work.id,
            sortKey: item.sortKey,
            order: item.order,
            correlation: correlationFor(item.work),
            label: item.work.label,
            workKind: item.work.kind,
            value: item.work,
          }
    )
  )
}

function correlationFor(item: ToolCallData | ToolCallGroupWorkEntry) {
  return {
    sessionId: item.sessionId,
    taskId: item.taskId,
    parentTaskId: item.parentTaskId,
    agentId: item.agentId,
    parentAgentId: item.parentAgentId,
    parentToolId: item.parentToolId,
  }
}

const COLLAPSED_TREE_STORAGE_PREFIX = "betterc0de:tool-tree:collapsed:"

function readCollapsedNodes(treeKey: string | undefined): Set<string> {
  if (!treeKey || typeof window === "undefined") return new Set()
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        `${COLLAPSED_TREE_STORAGE_PREFIX}${treeKey}`
      ) ?? "[]"
    )
    return Array.isArray(parsed)
      ? new Set(
          parsed.filter((value): value is string => typeof value === "string")
        )
      : new Set()
  } catch {
    return new Set()
  }
}

function writeCollapsedNodes(
  treeKey: string | undefined,
  collapsed: ReadonlySet<string>
): void {
  if (!treeKey || typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      `${COLLAPSED_TREE_STORAGE_PREFIX}${treeKey}`,
      JSON.stringify([...collapsed].sort())
    )
  } catch {
    // Storage is optional (private browsing and quota failures are harmless).
  }
}

function isToolFailed(tool: ToolCallData): boolean {
  return tool.state === "output-error" || !!tool.error
}

function isToolDone(tool: ToolCallData): boolean {
  return (
    tool.output !== undefined ||
    tool.state === "output-available" ||
    isToolFailed(tool)
  )
}

/** Wall-clock span of the turn's activity (first start → last completion),
 * falling back to the sum of per-tool durations when timestamps are absent. */
function groupDurationMs(
  tools: ToolCallData[],
  work: ToolCallGroupWorkEntry[]
): number | undefined {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let hasSum = false
  const push = (value: string | undefined) => {
    if (!value) return
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) return
    min = Math.min(min, parsed)
    max = Math.max(max, parsed)
  }
  for (const tool of tools) {
    push(tool.startedAt)
    push(tool.completedAt)
    if (typeof tool.durationMs === "number") {
      sum += tool.durationMs
      hasSum = true
    }
  }
  for (const entry of work) push(entry.createdAt)
  if (min !== Number.POSITIVE_INFINITY && max >= min) return max - min
  return hasSum ? sum : undefined
}

/** One badge in the header when every step shares a provider; per-row badges
 * otherwise (mixed-provider swarm turns). */
function uniqueProviderLabel(
  tools: ToolCallData[],
  work: ToolCallGroupWorkEntry[]
): string | undefined {
  const labels = new Set<string>()
  for (const tool of tools) {
    if (tool.providerKind || tool.providerInstanceId) {
      labels.add(formatProviderActivityLabel(tool, "Tool"))
    }
  }
  for (const entry of work) {
    if (entry.providerLabel) labels.add(entry.providerLabel)
    else if (entry.providerKind || entry.providerInstanceId) labels.add(formatProviderActivityLabel(entry))
  }
  if (labels.size !== 1) return undefined
  return [...labels][0]
}

function describeTool(tool: ToolCallData): ToolActivityDescription {
  return describeProviderToolActivity({
    toolName: tool.name,
    title: tool.title,
    kind: tool.kind,
    input: tool.input,
    output: tool.output,
    fallbackSummary: tool.name,
  })
}

/**
 * What decides whether a row folds (its action label) and what it contributes
 * to the folded label (the file, pattern or command that distinguishes it).
 * Folding by action alone used to hide "npm test" behind "Ran command ×16";
 * now the label lists the distinct details, so the count hides nothing a
 * reader needs.
 */
function toolRowFoldKey(node: GroupTreeNode): {
  signature: string
  detail?: string
} {
  if (node.kind === "work") {
    // Three plugins each run a SessionStart hook, so every turn opens with
    // three identical "Hook started" rows. Same-label work rows fold like
    // tool rows do; a failure never folds away.
    const work = node.value as ToolCallGroupWorkEntry | undefined
    if (!work || work.tone === "error") return { signature: "" }
    const detail = work.detail?.trim()
    return detail
      ? { signature: work.label, detail }
      : { signature: work.label }
  }
  if (node.kind !== "tool") return { signature: "" }
  const tool = node.value as ToolCallData | undefined
  if (!tool) return { signature: "" }
  // A failed row must never disappear into a count.
  if (isToolFailed(tool)) return { signature: "" }
  const description = describeTool(tool)
  const detail = foldDetail(description)
  return detail
    ? { signature: description.summary, detail }
    : { signature: description.summary }
}

const FOLD_DETAIL_MAX_LENGTH = 40

function foldDetail(description: ToolActivityDescription): string | undefined {
  const raw = description.path
    ? lastPathSegment(description.path)
    : (description.pattern ?? description.command ?? description.detail)
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  return trimmed.length > FOLD_DETAIL_MAX_LENGTH
    ? `${trimmed.slice(0, FOLD_DETAIL_MAX_LENGTH - 1)}…`
    : trimmed
}

function lastPathSegment(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized.split("/").pop() || normalized
}

function buildLiveLabel(running: ToolCallData): string {
  const presentation = describeTool(running)
  const detail = presentation.detail?.trim()
  return detail
    ? `${presentation.summary} · ${detail.slice(0, 48)}`
    : presentation.summary
}
