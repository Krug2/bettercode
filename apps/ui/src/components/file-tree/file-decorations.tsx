import { getFileIconUrl } from "@/lib/file-icons"

/**
 * Small visual helpers for the project file tree.
 *
 * Kept close to the file-tree components because neither helper is useful
 * anywhere else: `fileIcon` renders a Material-theme icon for a file name,
 * `folderColor` colors a folder label based on common repo conventions.
 */

export function fileIcon(name: string) {
  return (
    <img src={getFileIconUrl(name)} alt="" className="size-[18px] shrink-0" />
  )
}

export function folderColor(name: string): string {
  switch (name.toLowerCase()) {
    case "src":
    case "lib":
    case "app":
    case "apps":
      return "text-blue-400"
    case "components":
    case "ui":
      return "text-cyan-400"
    case "public":
    case "static":
    case "assets":
      return "text-emerald-400"
    case "test":
    case "tests":
    case "__tests__":
    case "spec":
      return "text-yellow-400"
    case "config":
    case "configs":
    case ".config":
      return "text-muted-foreground"
    case "scripts":
    case "bin":
      return "text-orange-400"
    case "docs":
    case "doc":
      return "text-purple-400"
    default:
      return "text-blue-400/70"
  }
}
