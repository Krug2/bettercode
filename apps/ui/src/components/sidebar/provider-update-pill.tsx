import { useEffect, useReducer, type CSSProperties } from "react"
import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import type { ProviderUpdateSidebarPillView } from "@/lib/provider-update-notification"
import { createProviderUpdateSession, reduceProviderUpdateSession } from "@/lib/provider-update-session"
import { useProviderInstances } from "@/hooks/use-provider-instances"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const PILL_TONE_STYLES = {
  loading: "bg-primary/15 text-primary hover:bg-primary/20",
  success: "bg-success/12 text-success hover:bg-success/18",
  warning: "bg-warning/12 text-warning hover:bg-warning/18",
  error: "bg-destructive/12 text-destructive hover:bg-destructive/18",
} as const

const PILL_PROGRESS_STYLES = {
  success: "bg-success/18",
  warning: "bg-warning/16",
  error: "bg-destructive/16",
} as const

export function SidebarProviderUpdatePill({
  onOpenProviderSettings,
}: {
  onOpenProviderSettings: () => void
}) {
  const { instances } = useProviderInstances()
  const [session, dispatch] = useReducer(reduceProviderUpdateSession, instances, createProviderUpdateSession)
  const view = session.notice
  useEffect(() => {
    dispatch({ type: "snapshot", providers: instances })
  }, [instances])

  useEffect(() => {
    if (!view?.dismissAfterVisibleMs) return
    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "dismiss", key: view.key })
    }, view.dismissAfterVisibleMs)
    return () => window.clearTimeout(timeoutId)
  }, [view?.dismissAfterVisibleMs, view?.key])

  if (!view) return null

  return (
    <div className="px-2 py-2">
      <div
        className={cn(
          "group/provider-update relative flex h-7 w-full items-center overflow-hidden rounded-lg text-xs font-medium transition-colors",
          PILL_TONE_STYLES[view.tone]
        )}
      >
        <ProviderUpdatePillProgress view={view} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={view.description}
              className="relative z-[1] flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left"
              onClick={onOpenProviderSettings}
            >
              <ProviderUpdatePillIcon tone={view.tone} />
              <span className="truncate">{view.title}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{view.description}</TooltipContent>
        </Tooltip>
        {view.dismissible ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Dismiss provider update notice"
                className="relative z-[1] mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
                onClick={() => dispatch({ type: "dismiss", key: view.key })}
              >
                <XIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Dismiss until provider status changes
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}

function ProviderUpdatePillProgress({
  view,
}: {
  view: ProviderUpdateSidebarPillView
}) {
  if (!view.dismissAfterVisibleMs || view.tone === "loading") return null
  return (
    <div
      key={view.key}
      aria-hidden="true"
      className={cn(
        "provider-update-pill-progress pointer-events-none absolute inset-y-0 left-0 w-full origin-left border-r border-current/15",
        PILL_PROGRESS_STYLES[view.tone]
      )}
      style={
        {
          "--provider-update-pill-dismiss-ms": `${view.dismissAfterVisibleMs}ms`,
        } as CSSProperties
      }
    />
  )
}

function ProviderUpdatePillIcon({
  tone,
}: {
  tone: ProviderUpdateSidebarPillView["tone"]
}) {
  if (tone === "loading")
    return <Loader2Icon className="size-3.5 animate-spin" />
  if (tone === "success") return <CheckCircle2Icon className="size-3.5" />
  if (tone === "error") return <TriangleAlertIcon className="size-3.5" />
  return <DownloadIcon className="size-3.5" />
}
