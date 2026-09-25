import { lazy, Suspense, useEffect } from "react"
import { ErrorBoundary } from "@/components/error-boundary"
import { MainArea } from "./main-area"
import { useUsagePageStore } from "@/lib/usage-page-store"
import { useSettingsStore } from "@/lib/settings-store"
import { getBackendMode } from "@/services/backend/runtime"
import type { MainAreaProps } from "@/hooks/use-app-shell-bundles"

const UsagePage = lazy(() => import("@/components/usage/usage-page"))
const DecisionSidebar = lazy(() =>
  import("@/components/decisions/decision-sidebar").then((module) => ({
    default: module.DecisionSidebar,
  }))
)

export function MainSurface(props: MainAreaProps) {
  const open = useUsagePageStore((state) => state.open)
  const decisionMode = useSettingsStore((state) => state.decisionLayer.mode)
  useEffect(
    () => useUsagePageStore.getState().setOpen(false),
    [props.activeThreadId, props.appMode]
  )
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className={open ? "hidden" : "contents"}>
        <MainArea {...props} />
      </div>
      {!open &&
        decisionMode !== "off" &&
        props.activeThreadId &&
        props.appMode === "agent" &&
        getBackendMode() !== "remote_http" && (
          <ErrorBoundary label="Decisions">
            <Suspense fallback={null}>
              <DecisionSidebar
                key={props.activeThreadId}
                threadId={
                  props.activeThread?.parentThreadId ?? props.activeThreadId
                }
                connected={props.wsReady}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      {open && (
        <ErrorBoundary label="Usage">
          <Suspense
            fallback={
              <div
                className="m-auto text-sm text-muted-foreground"
                role="status"
              >
                Loading usage…
              </div>
            }
          >
            <UsagePage
              onClose={() => {
                useUsagePageStore.getState().setOpen(false)
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>("[data-usage-nav]")
                    ?.focus()
                )
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
