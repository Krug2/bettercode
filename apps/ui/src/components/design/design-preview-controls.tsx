import { useState, type ReactNode } from "react"
import {
  CodeIcon,
  FileTextIcon,
  FolderOpenIcon,
  Loader2Icon,
  PaintbrushIcon,
  PaletteIcon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react"
import type { DesignBrief } from "@betterc0de/schema"
import { normalizePreviewUrl } from "@/lib/canvas-preview-source"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/lib/settings-store"
import type { useDevServer } from "@/hooks/use-dev-server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-primary/15 text-primary hover:bg-primary/20"
      )}
    >
      {children}
    </button>
  )
}

export function ToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px bg-border/60" />
}

export function ServerStatusPill({
  dev,
}: {
  dev: ReturnType<typeof useDevServer>
}) {
  const dot =
    dev.status === "running"
      ? "bg-emerald-500"
      : dev.status === "starting" || dev.status === "detecting"
        ? "bg-amber-500"
        : dev.status === "error"
          ? "bg-red-500"
          : "bg-muted-foreground/40"
  const label =
    dev.status === "running"
      ? "Running"
      : dev.status === "starting"
        ? "Starting…"
        : dev.status === "error"
          ? "Error"
          : "Server"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Dev server status and logs"
          aria-label={`Dev server: ${label}. Open controls and logs`}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className={cn("size-1.5 rounded-full", dot)} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={8} className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", dot)} />
            <span className="text-xs font-medium">
              Dev server{" "}
              <span className="text-muted-foreground">
                {dev.status}
                {dev.url ? ` — ${dev.url}` : ""}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            {dev.managed &&
              (dev.status === "running" || dev.status === "starting") && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={() => void dev.restart()}
                  >
                    <RotateCcwIcon className="size-3" />
                    Restart
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    className="h-6 gap-1 px-2 text-[11px] text-red-500 hover:text-red-400"
                    onClick={() => void dev.stop()}
                  >
                    <SquareIcon className="size-3" />
                    Stop
                  </Button>
                </>
              )}
            {!dev.managed &&
              dev.scriptName &&
              dev.status !== "running" &&
              dev.status !== "starting" && (
                <Button
                  size="xs"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => void dev.start()}
                >
                  <PlayIcon className="size-3" />
                  Start
                </Button>
              )}
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto bg-sidebar p-2">
          {dev.logs.length === 0 ? (
            <p className="px-1 py-3 text-center text-[10px] text-muted-foreground/50">
              {dev.managed
                ? "No output yet"
                : dev.status === "running"
                  ? "Server was started outside BetterC0de — logs unavailable."
                  : "Start the dev server to see its output here."}
            </p>
          ) : (
            <pre className="font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
              {dev.logs.join("\n")}
            </pre>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ArtboardEmptyState({
  projectPath,
  dev,
  onOpenProject,
  onNavigate,
}: {
  projectPath: string | null
  dev: ReturnType<typeof useDevServer>
  onOpenProject?: () => void
  onNavigate: (url: string | null) => void
}) {
  const [manualUrl, setManualUrl] = useState("")

  const submitManualUrl = () => {
    const normalized = normalizePreviewUrl(manualUrl)
    if (normalized) onNavigate(normalized)
  }

  if (!projectPath) {
    return (
      <EmptyStateCard
        icon={<FolderOpenIcon className="size-5" strokeWidth={1.5} />}
        title="No project attached"
        body="Open a folder so the agent can build in it and the canvas can preview your app."
      >
        {onOpenProject && (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onOpenProject}
          >
            <FolderOpenIcon className="size-3.5" />
            Open folder
          </Button>
        )}
      </EmptyStateCard>
    )
  }

  if (dev.status === "starting") {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        <Loader2Icon className="size-5 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Starting dev server…
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {dev.packageManager} run {dev.scriptName}
          </p>
          {dev.slowStart && (
            <p className="mt-2 text-[11px] text-amber-500">
              Taking longer than usual — check the logs or enter a URL manually.
            </p>
          )}
        </div>
        {dev.logs.length > 0 && (
          <pre className="max-h-28 w-full overflow-hidden rounded-md border border-border/60 bg-sidebar p-2 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
            {dev.logs.slice(-6).join("\n")}
          </pre>
        )}
      </div>
    )
  }

  if (dev.status === "error") {
    return (
      <EmptyStateCard
        icon={<SquareIcon className="size-5 text-red-500" strokeWidth={1.5} />}
        title="Dev server failed"
        body={
          dev.error ??
          "The dev server exited unexpectedly. Check the logs in the toolbar."
        }
      >
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void dev.start()}
        >
          <PlayIcon className="size-3.5" />
          Retry
        </Button>
      </EmptyStateCard>
    )
  }

  return (
    <EmptyStateCard
      icon={<SparklesIcon className="size-5" strokeWidth={1.5} />}
      title="Connect a live preview"
      body={
        dev.scriptName
          ? "Start the project's dev server and the canvas will pick up its URL automatically."
          : "No dev script found in package.json — start your server manually and enter its URL."
      }
    >
      {dev.scriptName && (
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void dev.start()}
        >
          <PlayIcon className="size-3.5" />
          Start dev server
          <span className="font-mono text-[10px] opacity-70">
            {dev.packageManager} run {dev.scriptName}
          </span>
        </Button>
      )}
      <div className="flex w-full max-w-xs items-center gap-1.5">
        <Input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitManualUrl()
          }}
          placeholder="http://localhost:3000"
          className="h-7 flex-1 rounded-md border-border/60 bg-background px-2 font-mono text-[11px]"
        />
        <Button
          variant="outline"
          size="xs"
          className="h-7 px-2 text-[11px]"
          onClick={submitManualUrl}
        >
          Open
        </Button>
      </div>
    </EmptyStateCard>
  )
}

function EmptyStateCard({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-border/60 bg-muted/25 text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  )
}

const TARGET_LABELS: Record<DesignBrief["target"], string> = {
  website: "Website",
  "mobile-app": "Mobile App",
  "website-mobile": "Website + Mobile",
  "desktop-app": "Desktop App",
  dashboard: "Dashboard",
}

const COLOR_LABELS: Record<DesignBrief["colorMode"], string> = {
  light: "Light mode",
  dark: "Dark mode",
  mixed: "Mixed sections",
}

export function BriefPopover({
  brief,
  onRemoveBrief,
}: {
  brief: DesignBrief
  onRemoveBrief: () => void
}) {
  const designDefaults = useSettingsStore((state) => state.designDefaults)

  const styleLabel = brief.styleTemplateId
    ? (designDefaults.styleTemplates.find((t) => t.id === brief.styleTemplateId)
        ?.name ?? brief.styleTemplateId)
    : "Custom Style"

  const fontLabel = brief.fontPresetId
    ? (designDefaults.fontPresets.find((f) => f.id === brief.fontPresetId)
        ?.name ?? brief.fontPresetId)
    : brief.customFont || "Custom (unset)"

  const customRefCount =
    brief.customStyleReferences.websiteLinks.length +
    brief.customStyleReferences.imageFiles.length +
    brief.customStyleReferences.htmlFiles.length +
    (brief.customStyleReferences.notes.trim() ? 1 : 0)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Saved design brief"
          aria-label="Saved design brief"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <FileTextIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-3">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          This saved brief is included in this chat's design context. Describe
          new changes directly in chat.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <BriefField
            icon={SparklesIcon}
            label="Target"
            value={TARGET_LABELS[brief.target]}
          />
          <BriefField
            icon={PaletteIcon}
            label="Color mode"
            value={COLOR_LABELS[brief.colorMode]}
          />
          <BriefField icon={PaintbrushIcon} label="Style" value={styleLabel} />
          <BriefField icon={TypeIcon} label="Typography" value={fontLabel} />
          <BriefField
            icon={CodeIcon}
            label="Components"
            value={
              brief.componentImports.length > 0
                ? `${brief.componentImports.length} imported`
                : "Project defaults"
            }
          />
          <BriefField
            icon={FileTextIcon}
            label="References"
            value={customRefCount > 0 ? `${customRefCount} attached` : "None"}
          />
        </div>
        {brief.description && (
          <p className="mt-3 line-clamp-4 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {brief.description}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={onRemoveBrief}
          className="mt-3 h-6 w-full gap-1.5 rounded-md border-border/60 text-[11px]"
        >
          <Trash2Icon className="size-3" strokeWidth={1.75} />
          Remove saved brief
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function BriefField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileTextIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        <Icon className="size-3" strokeWidth={1.75} />
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-foreground">
        {value}
      </div>
    </div>
  )
}
