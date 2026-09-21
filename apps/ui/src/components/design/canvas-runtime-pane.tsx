import { useEffect, useId, useMemo, useState } from "react"
import {
  ActivityIcon,
  ArrowDownUpIcon,
  RouteIcon,
  TerminalIcon,
  WrenchIcon,
  Trash2Icon,
  ServerIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useChatStore, useThreadActivities } from "@/lib/chat-store"
import type { UseDevServerResult } from "@/hooks/use-dev-server"
import type { ConsoleLog } from "@/components/browser-preview/types"
import "./canvas-runtime.css"
import {
  RuntimeRequestList,
  RuntimeEndpointList,
} from "./canvas-runtime-network"
import { canvasViewport, canvasViewportKey } from "./canvas-preview-store"
import {
  foldToolActivities,
  formatMillis,
  groupEndpoints,
  isApiRequest,
  replayScript,
  type EndpointSummary,
  type ToolRun,
} from "./canvas-runtime"
import {
  ensurePreviewRequestFeed,
  useCanvasRuntimeStore,
} from "./canvas-runtime-store"

type RuntimeTab = "requests" | "endpoints" | "logs" | "tools"

const TABS: ReadonlyArray<{
  id: RuntimeTab
  label: string
  icon: typeof ServerIcon
}> = [
  { id: "requests", label: "Requests", icon: ArrowDownUpIcon },
  { id: "endpoints", label: "Endpoints", icon: RouteIcon },
  { id: "logs", label: "Logs", icon: TerminalIcon },
  { id: "tools", label: "Tools", icon: WrenchIcon },
]

interface CanvasRuntimePaneProps {
  threadId: string
  /** Device ids of this card's previews; their guests' traffic is shown. */
  deviceIds: readonly string[]
  dev: UseDevServerResult
  /** Card-local pixels; the card's root scales the whole panel with its chrome. */
  width: number
  height: number
}

/**
 * The backend half of a canvas card: the requests its preview pages make,
 * the endpoints those imply (replayable when they are reads), the dev
 * server's output next to the pages' console, and the agent's tool runs on
 * this thread. Everything here is live; nothing is fetched on demand.
 */
export function CanvasRuntimePane({
  threadId,
  deviceIds,
  dev,
  width,
  height,
}: CanvasRuntimePaneProps) {
  const id = useId()
  const [tab, setTab] = useState<RuntimeTab>("requests")
  const [apiOnly, setApiOnly] = useState(true)
  useEffect(() => {
    ensurePreviewRequestFeed()
    void useChatStore.getState().hydrateThreadActivities?.(threadId)
  }, [threadId])

  const viewportKeys = deviceIds.map((id) => canvasViewportKey(threadId, id))
  const requestsByGuest = useCanvasRuntimeStore(
    (state) => state.requestsByGuest
  )
  const consoleByViewport = useCanvasRuntimeStore(
    (state) => state.consoleByViewport
  )
  const clearRequests = useCanvasRuntimeStore((state) => state.clearRequests)
  const clearConsole = useCanvasRuntimeStore((state) => state.clearConsole)
  const activities = useThreadActivities(threadId)

  // Guest ids are known once a webview is ready; the registry answers live.
  const guestIds = viewportKeys
    .map((key) => canvasViewport(key)?.getWebContentsId() ?? null)
    .filter((id): id is number => id !== null)
  // The key lists are rebuilt every render; their joined form is the stable
  // dependency the memos want.
  const guestList = guestIds.join(",")
  const viewportList = viewportKeys.join(",")
  const capturedRequests = useMemo(() => {
    const ids = guestList ? guestList.split(",").map(Number) : []
    const all = ids.flatMap((id) => requestsByGuest[id] ?? [])
    all.sort((a, b) => b.startedAt - a.startedAt)
    return all
  }, [requestsByGuest, guestList])
  const apiRequests = useMemo(
    () => capturedRequests.filter(isApiRequest),
    [capturedRequests]
  )
  const requests = apiOnly ? apiRequests : capturedRequests
  const endpoints = useMemo(() => groupEndpoints(apiRequests), [apiRequests])
  const consoleLogs = useMemo(() => {
    const keys = viewportList ? viewportList.split(",") : []
    const all = keys.flatMap((key) => consoleByViewport[key] ?? [])
    all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    return all
  }, [consoleByViewport, viewportList])
  const toolRuns = useMemo(() => foldToolActivities(activities), [activities])
  const errorCount = consoleLogs.filter((log) => log.level === "error").length
  const failedRequests = apiRequests.filter(
    (entry) => entry.error || (entry.statusCode ?? 0) >= 400
  ).length

  const replay = (endpoint: EndpointSummary) => {
    const key = viewportKeys.find((candidate) => canvasViewport(candidate))
    if (!key) return
    void canvasViewport(key)?.executeJavaScript(replayScript(endpoint.lastUrl))
  }

  return (
    <div
      data-canvas-runtime={threadId}
      data-canvas-controls
      className="canvas-runtime shrink-0"
      style={{ width }}
    >
      <div className="flex h-7 items-center gap-2 text-[11px] text-muted-foreground">
        <ServerIcon className="size-3.5" />
        <span>Runtime</span>
        <span className="font-mono text-[10px] tabular-nums opacity-60">
          {capturedRequests.length} requests · {toolRuns.length} tools
        </span>
        {failedRequests > 0 && (
          <span className="rounded bg-red-500/10 px-1 font-mono text-[10px] text-red-400 tabular-nums">
            {failedRequests} failed
          </span>
        )}
      </div>
      <div className="runtime-surface" style={{ height }}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="runtime-tabs"
            role="tablist"
            aria-label="Runtime view"
          >
            {TABS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${id}-${item.id}-tab`}
                aria-controls={`${id}-${item.id}-panel`}
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % TABS.length
                      : event.key === "ArrowLeft"
                        ? (index + TABS.length - 1) % TABS.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? TABS.length - 1
                            : null
                  if (next === null) return
                  event.preventDefault()
                  setTab(TABS[next].id)
                  document.getElementById(`${id}-${TABS[next].id}-tab`)?.focus()
                }}
              >
                <item.icon aria-hidden="true" />
                {item.label}
                {item.id === "requests" && (
                  <span className="runtime-tab-count">
                    {capturedRequests.length}
                  </span>
                )}
                {item.id === "tools" && (
                  <span className="runtime-tab-count">{toolRuns.length}</span>
                )}
                {item.id === "logs" && errorCount > 0 && (
                  <span className="rounded bg-red-500/10 px-1 text-[10px] text-red-400 tabular-nums">
                    {errorCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div
            className="runtime-tabpanel"
            role="tabpanel"
            id={`${id}-${tab}-panel`}
            aria-labelledby={`${id}-${tab}-tab`}
            tabIndex={0}
          >
            {tab === "requests" && (
              <RuntimeRequestList
                totalCount={capturedRequests.length}
                requests={requests}
                apiOnly={apiOnly}
                onApiOnlyChange={setApiOnly}
                onClear={() => clearRequests(guestIds)}
              />
            )}
            {tab === "endpoints" && (
              <RuntimeEndpointList endpoints={endpoints} onReplay={replay} />
            )}
            {tab === "logs" && (
              <div className="runtime-scroll">
                <RuntimeLogs
                  dev={dev}
                  consoleLogs={consoleLogs}
                  onClearConsole={() => clearConsole(viewportKeys)}
                />
              </div>
            )}
            {tab === "tools" && (
              <div className="runtime-scroll">
                <ToolRunList runs={toolRuns} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-8 text-center text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

function RuntimeLogs({
  dev,
  consoleLogs,
  onClearConsole,
}: {
  dev: UseDevServerResult
  consoleLogs: readonly ConsoleLog[]
  onClearConsole: () => void
}) {
  const serverLabel =
    dev.status === "running"
      ? dev.managed
        ? "Dev server · running"
        : "Dev server · running (external)"
      : dev.status === "starting"
        ? "Dev server · starting"
        : dev.status === "error"
          ? "Dev server · error"
          : dev.status === "stopped"
            ? `Dev server · exited${dev.exitCode !== null ? ` (${dev.exitCode})` : ""}`
            : "Dev server · not started"
  return (
    <div className="text-[10px]">
      <div className="runtime-section-title">
        <ActivityIcon className="size-3" />
        <span>{serverLabel}</span>
      </div>
      {dev.logs.length === 0 ? (
        <Empty>
          {dev.managed || dev.status === "starting"
            ? "Waiting for output…"
            : "Start the dev server from the card to see its output here."}
        </Empty>
      ) : (
        <pre className="max-h-64 overflow-y-auto px-3 py-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
          {dev.logs.slice(-120).join("\n")}
        </pre>
      )}
      <div className="runtime-section-title">
        <span>Console</span>
        <span className="flex-1" />
        {consoleLogs.length > 0 && (
          <button
            type="button"
            onClick={onClearConsole}
            aria-label="Clear console"
            title="Clear console"
            className="runtime-icon-button"
          >
            <Trash2Icon />
          </button>
        )}
      </div>
      {consoleLogs.length === 0 ? (
        <Empty>No console output</Empty>
      ) : (
        <div className="space-y-px p-2 font-mono">
          {consoleLogs.map((log, index) => (
            <div
              key={`${log.timestamp.getTime()}-${index}`}
              className={cn(
                "runtime-log-row rounded",
                log.level === "error" && "bg-red-500/5 text-red-400",
                log.level === "warn" && "bg-yellow-500/5 text-yellow-400",
                log.level === "log" && "text-muted-foreground"
              )}
            >
              <time>{log.timestamp.toLocaleTimeString()}</time>
              {log.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ToolRunList({ runs }: { runs: readonly ToolRun[] }) {
  if (runs.length === 0)
    return (
      <Empty>Tool calls of this chat show up here while the agent works.</Empty>
    )
  return (
    <ul className="divide-y divide-border/30 text-[10px]">
      {runs.map((run) => {
        const started = Date.parse(run.startedAt)
        const ended = run.endedAt ? Date.parse(run.endedAt) : null
        const elapsed =
          Number.isFinite(started) && ended !== null && Number.isFinite(ended)
            ? formatMillis(Math.max(0, ended - started))
            : null
        return (
          <li
            key={run.toolId}
            data-tool-status={run.status}
            className="runtime-tool-row"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                run.status === "running" && "bg-primary",
                run.status === "completed" && "bg-emerald-400",
                run.status === "failed" && "bg-red-400",
                run.status === "denied" && "bg-amber-400"
              )}
            />
            <span className="min-w-0 flex-1 truncate" title={run.summary}>
              {run.summary || run.toolId}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {run.status === "running" ? "running" : run.status}
            </span>
            {elapsed && (
              <span className="w-12 shrink-0 text-right text-muted-foreground tabular-nums">
                {elapsed}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
