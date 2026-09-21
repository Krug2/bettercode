import { memo, useEffect, useId, useRef, useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { TAG_COLORS } from "./constants"
import { containsElement, elementName } from "./element-tree"
import type { DomNode } from "./types"

interface DomTreeNodeProps {
  node: DomNode
  depth: number
  selectedSelector: string | null
  onSelect: (selector: string) => void
  onHighlight: (selector: string) => void
  forceExpanded?: boolean
}

export const DomTreeNode = memo(function DomTreeNode({
  node, depth, selectedSelector, onSelect, onHighlight, forceExpanded = false,
}: DomTreeNodeProps) {
  const containsSelection = containsElement(node, selectedSelector)
  const [expanded, setExpanded] = useState(depth < 2 || containsSelection)
  const rowRef = useRef<HTMLDivElement>(null)
  const groupId = useId()
  const hasChildren = node.children.length > 0
  const isSelected = selectedSelector === node.selector
  const isExpanded = expanded || forceExpanded
  const name = elementName(node)
  const classLabel = node.classes.map((name) => `.${name}`).join(" ")

  // Picking a deeply nested element in the preview reveals its ancestors.
  useEffect(() => { if (containsSelection) setExpanded(true) }, [containsSelection, selectedSelector])
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [isSelected])

  return (
    <div>
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-owns={hasChildren && isExpanded ? groupId : undefined}
        aria-label={`${node.tag}: ${name}`}
        tabIndex={isSelected || depth === 0 ? 0 : -1}
        data-element-selector={node.selector}
        title={[node.selector, classLabel, node.text].filter(Boolean).join("\n")}
        className={cn("preview-element-row", isSelected && "is-selected")}
        style={{ paddingLeft: Math.min(depth, 8) * 14 + 4 }}
        onClick={() => onSelect(node.selector)}
        onMouseEnter={() => onHighlight(node.selector)}
        onFocus={() => onHighlight(node.selector)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelect(node.selector)
          } else if (event.key === "ArrowRight" && hasChildren && !isExpanded) {
            event.preventDefault()
            event.stopPropagation()
            setExpanded(true)
          } else if (event.key === "ArrowLeft" && hasChildren && isExpanded && !forceExpanded) {
            event.preventDefault()
            event.stopPropagation()
            setExpanded(false)
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
            aria-expanded={isExpanded}
            disabled={forceExpanded}
            className="preview-element-toggle"
            onClick={(event) => { event.stopPropagation(); setExpanded(!expanded) }}
          >
            <ChevronRightIcon className={cn("size-3 transition-transform", isExpanded && "rotate-90")} />
          </button>
        ) : <span className="w-6 shrink-0" />}
        <span className={cn("preview-element-tag", TAG_COLORS[node.tag] || "text-muted-foreground")}>{node.tag}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-4">{name}</span>
          {classLabel && (node.id || node.text.trim()) && (
            <span className="block truncate text-[10px] leading-4 text-muted-foreground">{classLabel}</span>
          )}
        </span>
        {hasChildren && <span className="pr-1 text-[10px] tabular-nums text-muted-foreground/60">{node.children.length}</span>}
      </div>
      {isExpanded && hasChildren && (
        <div role="group" id={groupId}>
          {node.children.map((child, i) => (
            <DomTreeNode key={`${child.selector}-${i}`} node={child} depth={depth + 1}
              selectedSelector={selectedSelector} onSelect={onSelect} onHighlight={onHighlight}
              forceExpanded={forceExpanded} />
          ))}
        </div>
      )}
    </div>
  )
})
