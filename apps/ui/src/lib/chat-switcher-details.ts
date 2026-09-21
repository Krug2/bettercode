import type { ChatThread } from "@betterc0de/schema"
import { lastRecordedModelId } from "./chat/pure-helpers"

export function chatModelSelection(
  thread: ChatThread | undefined,
  selectedModel?: string
): {
  id?: string
  source: "used" | "selected" | "unknown"
} {
  const recorded = thread && lastRecordedModelId(thread)
  if (recorded) return { id: recorded, source: "used" }
  if (selectedModel?.trim())
    return { id: selectedModel.trim(), source: "selected" }
  return { source: "unknown" }
}

export function chatProjectLabel(thread: ChatThread | undefined): string {
  return (
    thread?.projectName?.trim() ||
    thread?.projectPath
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ||
    "No project"
  )
}

export function chatActivityLabel(
  updatedAt: string | undefined,
  now = Date.now()
): string {
  const timestamp = Date.parse(updatedAt ?? "")
  if (!Number.isFinite(timestamp)) return ""
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7
    ? `${days}d ago`
    : new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
}
