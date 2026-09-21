import { useRef, useEffect, useMemo } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { FileRow } from "./file-row"
import { cn } from "@/lib/utils"

export interface VirtualListItem {
  key: string
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number | null
  mtime: number | null
  parentHint?: string
}

interface FileListVirtualProps {
  items: VirtualListItem[]
  selectedIndex: number
  onSelect: (index: number) => void
  onActivate: (index: number) => void
  isFavorite: (path: string) => boolean
  onToggleFavorite: (path: string) => void
  listboxId: string
  ariaLabel: string
  empty?: React.ReactNode
  className?: string
}

const ROW_HEIGHT = 32
const OVERSCAN = 10

export function FileListVirtual(props: FileListVirtualProps) {
  const {
    items,
    selectedIndex,
    onSelect,
    onActivate,
    isFavorite,
    onToggleFavorite,
    listboxId,
    ariaLabel,
    empty,
    className,
  } = props
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  // Keep the selected row in view when arrow-navigating.
  useEffect(() => {
    if (items.length === 0) return
    if (selectedIndex < 0 || selectedIndex >= items.length) return
    rowVirtualizer.scrollToIndex(selectedIndex, { align: "auto" })
  }, [selectedIndex, items.length, rowVirtualizer])

  const activeId = useMemo(() => {
    if (selectedIndex < 0 || selectedIndex >= items.length) return undefined
    return `${listboxId}-row-${selectedIndex}`
  }, [selectedIndex, items, listboxId])

  if (items.length === 0 && empty) {
    return (
      <div className={cn("flex h-full min-h-0 items-center justify-center text-xs text-muted-foreground", className)}>
        {empty}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto py-1",
        "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40",
        className,
      )}
      role="listbox"
      id={listboxId}
      aria-label={ariaLabel}
      aria-activedescendant={activeId}
      tabIndex={-1}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          const selected = virtualRow.index === selectedIndex
          return (
            <div
              key={item.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <FileRow
                id={`${listboxId}-row-${virtualRow.index}`}
                name={item.name}
                path={item.path}
                isDir={item.isDir}
                isSymlink={item.isSymlink}
                size={item.size}
                mtime={item.mtime}
                selected={selected}
                isFavorite={isFavorite(item.path)}
                onToggleFavorite={() => onToggleFavorite(item.path)}
                parentHint={item.parentHint}
                onClick={() => onSelect(virtualRow.index)}
                onDoubleClick={() => onActivate(virtualRow.index)}
                ariaPosInSet={virtualRow.index + 1}
                ariaSetSize={items.length}
                height={ROW_HEIGHT}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
