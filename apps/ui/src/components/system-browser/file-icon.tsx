import { getFileIconUrl, getFolderIconUrl } from "@/lib/file-icons"
import { cn } from "@/lib/utils"

export function EntryIcon({
  name,
  isDir,
  className,
}: {
  name: string
  isDir: boolean
  className?: string
}) {
  return (
    <img
      src={isDir ? getFolderIconUrl(false, name) : getFileIconUrl(name)}
      alt=""
      draggable={false}
      className={cn("size-4 shrink-0", className)}
    />
  )
}
