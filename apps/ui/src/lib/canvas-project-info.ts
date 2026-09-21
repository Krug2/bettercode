import type { ChatThread } from "@betterc0de/schema"
import type { ThreadSettings } from "@/lib/chat/types"
import { lastRecordedModelId } from "@/lib/chat/pure-helpers"

/** Canvas cards describe the current chat; history menus describe past turns. */
export function canvasModelSelection(
  thread: ChatThread | undefined,
  settings: ThreadSettings | undefined,
  streamingModelId: string | null | undefined,
  running: boolean
): { id?: string; source: "current" | "selected" | "used" | "unknown" } {
  const live = streamingModelId?.trim()
  if (running && live) return { id: live, source: "current" }

  const selected = (
    (settings?.selectedProviderId
      ? settings.modelSelectionByProvider?.[settings.selectedProviderId]
          ?.selectedModel
      : undefined) ?? settings?.selectedModel
  )?.trim()
  const recorded = thread && lastRecordedModelId(thread)
  if (!running && selected) return { id: selected, source: "selected" }
  // Reconnected sessions may have a durable last model before stream metadata
  // arrives. Do not label the next-turn selection as the running model.
  if (recorded) return { id: recorded, source: "used" }
  if (selected) return { id: selected, source: "selected" }
  return { source: "unknown" }
}
