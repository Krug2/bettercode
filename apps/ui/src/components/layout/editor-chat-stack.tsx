import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

function ChatStackDropZone({
  tabId,
  index,
  insertIntoSplit,
  children,
}: {
  tabId: string
  index: number
  insertIntoSplit?: (tabId: string, atIndex: number) => void
  children: ReactNode
}) {
  const [hoverZone, setHoverZone] = useState<
    "before" | "after" | "center" | null
  >(null)
  const zoneAt = (event: React.DragEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const y = event.clientY - bounds.top
    return y < bounds.height * 0.2
      ? "before"
      : y > bounds.height * 0.8
        ? "after"
        : "center"
  }

  return (
    <div
      data-editor-chat-panel={tabId}
      className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-background"
      onDragOver={(event) => {
        if (
          !insertIntoSplit ||
          !event.dataTransfer.types.includes("application/betterc0de-tab")
        )
          return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setHoverZone(zoneAt(event))
      }}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return
        setHoverZone(null)
      }}
      onDrop={(event) => {
        const droppedId = event.dataTransfer.getData(
          "application/betterc0de-tab"
        )
        setHoverZone(null)
        if (!droppedId || !insertIntoSplit) return
        event.preventDefault()
        event.stopPropagation()
        insertIntoSplit(
          droppedId,
          zoneAt(event) === "after" ? index + 1 : index
        )
      }}
    >
      {children}
      {hoverZone && (
        <div
          className={cn(
            "pointer-events-none absolute right-0 left-0 bg-primary/15",
            hoverZone === "before" &&
              "top-0 h-1/3 border-t-2 border-primary/60",
            hoverZone === "after" &&
              "bottom-0 h-1/3 border-b-2 border-primary/60",
            hoverZone === "center" &&
              "inset-2 rounded-md border-2 border-primary/60"
          )}
        />
      )}
    </div>
  )
}

/** Editor chats share one column; short windows scroll the stack. */
export function EditorChatStack({
  activeTabIds,
  insertIntoSplit,
  renderColumn,
}: {
  activeTabIds: string[]
  insertIntoSplit?: (tabId: string, atIndex: number) => void
  renderColumn: (id: string) => ReactNode
}) {
  return (
    <div
      className="grid min-h-0 flex-1 gap-2 overflow-y-auto bg-background p-2"
      role="region"
      aria-label="Stacked chats"
      style={{
        gridTemplateColumns: "minmax(0, 1fr)",
        gridAutoRows: "minmax(320px, 1fr)",
      }}
    >
      {activeTabIds.map((id, index) => (
        <ChatStackDropZone
          key={id}
          tabId={id}
          index={index}
          insertIntoSplit={
            insertIntoSplit && ((tabId, slot) => {
              // The insertion callback removes the dragged panel first.
              const previousIndex = activeTabIds.indexOf(tabId)
              insertIntoSplit(
                tabId,
                previousIndex >= 0 && previousIndex < slot ? slot - 1 : slot
              )
            })
          }
        >
          {renderColumn(id)}
        </ChatStackDropZone>
      ))}
    </div>
  )
}
