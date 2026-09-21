import type { LucideIcon } from "lucide-react"
import {
  FolderOpenIcon,
  GitCommitVerticalIcon,
  GlobeIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react"
import { FileIcon as LucideFileIcon, PencilIcon } from "lucide-react"

/**
 * Pick a lucide icon for a tool call based on its name.
 *
 * Heuristic only — many tools share similar verbs (read/write/search/...).
 * Used in the message view to prefix each tool-call entry with a matching
 * icon without hard-coding a mapping per provider.
 */
export function toolStepIcon(name: string): LucideIcon {
  const n = name.toLowerCase()
  if (n.includes("search") || n.includes("grep") || n.includes("find"))
    return SearchIcon
  if (n.includes("read") || n.includes("file") || n.includes("cat"))
    return LucideFileIcon
  if (n.includes("write") || n.includes("edit") || n.includes("patch"))
    return PencilIcon
  if (
    n.includes("bash") ||
    n.includes("exec") ||
    n.includes("command") ||
    n.includes("shell")
  )
    return TerminalIcon
  if (
    n.includes("web") ||
    n.includes("fetch") ||
    n.includes("http") ||
    n.includes("browse")
  )
    return GlobeIcon
  if (n.includes("git")) return GitCommitVerticalIcon
  if (n.includes("list") || n.includes("glob")) return FolderOpenIcon
  return WrenchIcon
}

/**
 * Pick the icon from the classified tool action first and fall back to the
 * name heuristic. ACP providers report a `kind` per call while their titles
 * can be anything — for a grep the title *is* the pattern — so a name-only
 * guess would draw a file icon for a search of "readFile".
 */
export function toolActionIcon(
  action: string | undefined,
  name: string
): LucideIcon {
  switch (action) {
    case "read":
      return LucideFileIcon
    case "search":
      return SearchIcon
    case "file_change":
      return PencilIcon
    case "command":
      return TerminalIcon
    case "list":
      return FolderOpenIcon
    default:
      return toolStepIcon(name)
  }
}
