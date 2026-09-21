import { useId, useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  FileCode2Icon,
  FolderOpenIcon,
  GlobeIcon,
  Loader2Icon,
  ServerIcon,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { normalizePreviewUrl } from "@/lib/canvas-preview-source"
import type { useCanvasPreviewSource } from "@/hooks/use-canvas-preview-source"

export function CanvasPreviewSourceControl({
  preview,
}: {
  preview: ReturnType<typeof useCanvasPreviewSource>
}) {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const { source } = preview
  const Icon =
    source.kind === "html"
      ? FileCode2Icon
      : source.kind === "server"
        ? ServerIcon
        : GlobeIcon
  const label =
    source.kind === "html"
      ? source.relativePath
      : preview.url?.replace(/^https?:\/\//, "").replace(/\/$/, "") ||
        "Choose a source"
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setValue(source.kind === "url" ? source.url : "")
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Change preview source: ${label}`}
          title={label}
          className="group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border/70 bg-background/50 px-3 text-left transition-colors hover:border-muted-foreground/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] leading-3.5 text-muted-foreground">
              {source.kind === "html"
                ? "HTML file"
                : source.kind === "server"
                  ? "Dev server · Auto"
                  : "Preview URL"}
            </span>
            <span className="block truncate text-xs leading-4 font-medium">
              {label}
            </span>
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-4 p-4"
        data-canvas-controls
      >
        <div>
          <p className="text-sm font-medium">Preview source</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Connect a website or open an HTML file from this project.
          </p>
        </div>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const url = normalizePreviewUrl(value)
            if (!url) {
              setError("Enter a valid http or https address.")
              return
            }
            preview.select({ kind: "url", url })
            setOpen(false)
          }}
        >
          <label htmlFor={inputId} className="text-xs font-medium">
            Website address
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
              }}
              placeholder="localhost:3000"
              className="h-9 min-w-0 flex-1 text-xs"
              aria-invalid={Boolean(error)}
            />
            <Button type="submit" size="sm" className="h-9">
              Open
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
        <div className="space-y-1 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => {
              preview.select({ kind: "server" })
              setOpen(false)
            }}
            className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              <span className="block text-xs font-medium">
                Use project dev server
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Follow the server started for this project
              </span>
            </span>
            {source.kind === "server" && <CheckIcon className="size-3.5" />}
          </button>
          <button
            type="button"
            disabled={!preview.canChooseHtml || preview.busy}
            onClick={() => void preview.chooseHtml()}
            className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            {preview.busy ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            ) : (
              <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span>
              <span className="block text-xs font-medium">
                Choose HTML file…
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {preview.canChooseHtml
                  ? "Local preview · no server needed"
                  : "Requires a project folder in the desktop app"}
              </span>
            </span>
          </button>
        </div>
        {preview.error && (
          <p role="alert" className="text-xs break-words text-destructive">
            {preview.error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
