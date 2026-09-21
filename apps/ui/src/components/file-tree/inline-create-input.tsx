import { useEffect, useRef } from "react"
import { getFileIconUrl, getFolderIconUrl } from "@/lib/file-icons"

/**
 * Inline input used by the file tree to create a new file/folder or rename
 * an existing one, without leaving the tree view.
 *
 * Focus + selection behavior mimics VS Code: on mount we select the
 * base-name portion (everything before the last `.`) so the user can
 * replace it without also erasing the extension.
 *
 * Pressing Enter commits; Escape cancels. Blur commits if the value changed,
 * otherwise cancels — matching what most IDEs do with rename affordances.
 */
export function InlineCreateInput({
  type,
  depth,
  initialValue = "",
  onCommit,
  onCancel,
}: {
  type: "file" | "folder"
  depth: number
  initialValue?: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Select everything except extension so user can just type a new base name
    if (initialValue) {
      const dot = initialValue.lastIndexOf(".")
      if (dot > 0) el.setSelectionRange(0, dot)
      else el.select()
    }
  }, [initialValue])
  return (
    <div
      className="flex min-h-7 items-center gap-1.5 py-px"
      style={{ paddingLeft: depth * 8 + 7, paddingRight: 4 }}
    >
      {type === "folder" ? (
        <img src={getFolderIconUrl(false, initialValue)} alt="" draggable={false} className="size-[18px] shrink-0 2xl:size-5" />
      ) : (
        <img src={getFileIconUrl(initialValue)} alt="" draggable={false} className="size-[18px] shrink-0 2xl:size-5" />
      )}
      <input
        ref={inputRef}
        type="text"
        defaultValue={initialValue}
        className="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-xs outline-none 2xl:text-[13px]"
        placeholder={type === "folder" ? "folder name" : "file name"}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onCommit((e.target as HTMLInputElement).value)
          } else if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={(e) => {
          const v = e.target.value
          if (v.trim() && v !== initialValue) onCommit(v)
          else onCancel()
        }}
      />
    </div>
  )
}
