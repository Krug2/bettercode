import { useMemo, useState } from "react"
import type {
  WorkspaceContextSource,
  WorkspaceContextSourceKind,
} from "@betterc0de/schema"
import {
  ArchiveIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderTreeIcon,
  HistoryIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PencilIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  buildContextSourceTree,
  type ContextSourceTreeNode,
} from "@/lib/context-source-tree"
import { formatTokens } from "@/lib/format"
import { openSourceTarget } from "@/lib/source-opener"
import { cn } from "@/lib/utils"

interface ContextSourceTreeProps {
  sources: readonly WorkspaceContextSource[]
  workspaceRoot: string
}

export function ContextSourceTree({
  sources,
  workspaceRoot,
}: ContextSourceTreeProps) {
  const roots = useMemo(() => buildContextSourceTree(sources), [sources])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () =>
      new Set(
        roots
          .filter((node) => node.children.length > 0)
          .map((node) => node.source.id)
      )
  )

  const setExpanded = (id: string, expanded: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (expanded) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div
      role="tree"
      aria-label="Context sources"
      className="divide-y divide-border/50"
    >
      {roots.map((node) => (
        <ContextTreeNode
          key={node.source.id}
          node={node}
          level={1}
          workspaceRoot={workspaceRoot}
          expandedIds={expandedIds}
          setExpanded={setExpanded}
        />
      ))}
    </div>
  )
}

interface ContextTreeNodeProps {
  node: ContextSourceTreeNode
  level: number
  workspaceRoot: string
  expandedIds: ReadonlySet<string>
  setExpanded: (id: string, expanded: boolean) => void
}

function ContextTreeNode({
  node,
  level,
  workspaceRoot,
  expandedIds,
  setExpanded,
}: ContextTreeNodeProps) {
  const { source, children } = node
  const hasChildren = children.length > 0
  const expanded = hasChildren && expandedIds.has(source.id)
  const pathIsLabel = source.sourcePath === source.label

  const openPath = () => {
    if (!source.sourcePath) return
    const target = /^https?:\/\//i.test(source.sourcePath)
      ? ({ kind: "external", url: source.sourcePath } as const)
      : ({ kind: "file", filePath: source.sourcePath } as const)
    void openSourceTarget(target, {
      workspacePath: workspaceRoot,
      allowOutsideWorkspace: true,
      preview: true,
    })
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => setExpanded(source.id, open)}
      role="treeitem"
      aria-level={level}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <div
        className={cn(
          "group/source flex items-start gap-2 px-3 py-2.5",
          !source.included && "opacity-60"
        )}
      >
        {hasChildren ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${source.label}`}
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 transition-transform",
                  expanded && "rotate-90"
                )}
              />
            </button>
          </CollapsibleTrigger>
        ) : (
          <span aria-hidden="true" className="size-5 shrink-0" />
        )}

        <ContextKindIcon kind={source.kind} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {pathIsLabel ? (
                <button
                  type="button"
                  title={source.sourcePath ?? undefined}
                  onClick={openPath}
                  className="block max-w-full truncate text-left text-xs font-medium text-foreground underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline"
                >
                  {source.label}
                </button>
              ) : (
                <p
                  title={source.label}
                  className="truncate text-xs font-medium text-foreground"
                >
                  {source.label}
                </p>
              )}
              {source.sourcePath && !pathIsLabel ? (
                <>
                  <button
                    type="button"
                    title={source.sourcePath}
                    onClick={openPath}
                    className="mt-0.5 block max-w-full truncate text-left font-mono text-[10px] text-muted-foreground underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline"
                  >
                    {source.sourcePath}
                  </button>
                  {source.detail ? (
                    <p
                      title={source.detail}
                      className="mt-0.5 truncate text-[10px] text-muted-foreground"
                    >
                      {source.detail}
                    </p>
                  ) : null}
                </>
              ) : source.detail ? (
                <p
                  title={source.detail}
                  className="mt-0.5 truncate text-[10px] text-muted-foreground"
                >
                  {source.detail}
                </p>
              ) : null}
            </div>

            <div className="shrink-0 text-right tabular-nums">
              <p className="font-mono text-[10px] text-foreground">
                {formatTokens(source.estimatedTokens)}
              </p>
              <p
                className={cn(
                  "text-[9px] font-medium",
                  source.included ? "text-success" : "text-muted-foreground"
                )}
              >
                {source.included ? "included" : "excluded"}
                {source.truncated ? " · clipped" : ""}
              </p>
            </div>
          </div>

          <p
            title={source.reason}
            className="mt-1 text-[10px] leading-relaxed text-pretty text-muted-foreground"
          >
            {source.reason}
          </p>
        </div>
      </div>

      {hasChildren ? (
        <CollapsibleContent>
          <div role="group" className="ml-5 border-l border-border/60 pl-2">
            {children.map((child) => (
              <ContextTreeNode
                key={child.source.id}
                node={child}
                level={level + 1}
                workspaceRoot={workspaceRoot}
                expandedIds={expandedIds}
                setExpanded={setExpanded}
              />
            ))}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

function ContextKindIcon({ kind }: { kind: WorkspaceContextSourceKind }) {
  const className = "mt-1 size-3.5 shrink-0 text-muted-foreground"
  switch (kind) {
    case "system":
      return <SettingsIcon aria-hidden="true" className={className} />
    case "rules":
      return <FolderTreeIcon aria-hidden="true" className={className} />
    case "rule":
      return <FileTextIcon aria-hidden="true" className={className} />
    case "history":
      return <HistoryIcon aria-hidden="true" className={className} />
    case "message":
      return <MessageSquareIcon aria-hidden="true" className={className} />
    case "tool":
      return <WrenchIcon aria-hidden="true" className={className} />
    case "attachment":
      return <PaperclipIcon aria-hidden="true" className={className} />
    case "prompt":
      return <PencilIcon aria-hidden="true" className={className} />
    case "compaction":
      return <ArchiveIcon aria-hidden="true" className={className} />
  }
}
