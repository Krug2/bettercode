import { useEffect, useRef, useState, type DragEvent } from "react"
import {
  FILE_TREE_DRAG_TYPE,
  resolveFileTreeMove,
  type FileTreeMove,
} from "@/lib/file-tree-move"
import { resolveFileTreeDropTarget, type FileTreeDropTarget } from "@/lib/file-tree-drop-target"

export interface FileTreeDragState {
  sourcePath: string | null
  targetDirectory: string | null
  insertion?: { path: string; edge: "before" | "after" } | null
}

export function useFileTreeDragDrop({
  projectPath,
  busy,
  onMove,
  onExpand,
}: {
  projectPath: string
  busy: boolean
  onMove: (move: FileTreeMove) => void
  onExpand: (directory: string) => void
}) {
  const source = useRef<{ path: string; projectPath: string } | null>(null)
  const hover = useRef<FileTreeDropTarget | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragState, setDragState] = useState<FileTreeDragState>({
    sourcePath: null,
    targetDirectory: null,
  })

  const clearHover = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    hover.current = null
  }
  const reset = () => {
    clearHover()
    source.current = null
    setDragState({ sourcePath: null, targetDirectory: null })
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      source.current = null
    },
    [projectPath]
  )

  const dropTarget = (event: DragEvent<HTMLElement>): FileTreeDropTarget | null => {
    if (busy || source.current?.projectPath !== projectPath) return null
    if (!event.dataTransfer.types.includes(FILE_TREE_DRAG_TYPE)) return null
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest("input, textarea")) return null
    const row = target.closest<HTMLElement>("[data-betterc0de-file-tree-path]")
    if (row) {
      const path = row.dataset.betterc0deFileTreePath!
      const bounds = row.getBoundingClientRect()
      return resolveFileTreeDropTarget({
        path,
        kind: row.dataset.betterc0deFileTreeKind === "folder" ? "folder" : "file",
        top: bounds.top,
        height: bounds.height,
        clientY: event.clientY,
      })
    }
    if (target.closest("button:not([data-slot='collapsible-trigger'])")) return null
    return { directory: "", rowPath: null, placement: "inside" }
  }

  return {
    dragState,
    dragHandlers: {
      onDragStart(event: DragEvent<HTMLElement>) {
        const target = event.target instanceof Element ? event.target : null
        const row = target?.closest<HTMLElement>(
          "[data-betterc0de-file-tree-path]"
        )
        if (busy || !row || target?.closest("button, input, textarea")) {
          event.preventDefault()
          return
        }
        event.stopPropagation()
        const path = row.dataset.betterc0deFileTreePath!
        source.current = { path, projectPath }
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData(FILE_TREE_DRAG_TYPE, path)
        setDragState({ sourcePath: path, targetDirectory: null })
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!source.current) return
        event.stopPropagation()
        const target = dropTarget(event)
        const valid =
          target !== null &&
          resolveFileTreeMove(source.current.path, target.directory)
        event.dataTransfer.dropEffect = valid ? "move" : "none"
        if (!valid) {
          if (hover.current !== null) {
            clearHover()
            setDragState({
              sourcePath: source.current.path,
              targetDirectory: null,
            })
          }
          return
        }
        event.preventDefault()
        if (hover.current?.directory === target.directory &&
          hover.current.rowPath === target.rowPath &&
          hover.current.placement === target.placement) return
        clearHover()
        hover.current = target
        setDragState({
          sourcePath: source.current.path,
          targetDirectory: target.directory,
          insertion: target.rowPath !== null && target.placement !== "inside"
            ? { path: target.rowPath, edge: target.placement }
            : null,
        })
        if (target.placement === "inside") {
          timer.current = setTimeout(() => onExpand(target.directory), 500)
        }
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return
        clearHover()
        setDragState({
          sourcePath: source.current?.path ?? null,
          targetDirectory: null,
        })
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!source.current) return
        event.preventDefault()
        event.stopPropagation()
        const target = dropTarget(event)
        const move =
          target === null
            ? null
            : resolveFileTreeMove(source.current.path, target.directory)
        reset()
        if (move) onMove(move)
      },
      onDragEnd: reset,
    },
  }
}
