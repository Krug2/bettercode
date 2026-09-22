import { lazy, Suspense } from "react"
import { ErrorBoundary } from "@/components/error-boundary"
import { MainArea } from "./main-area"
import { useUsagePageStore } from "@/lib/usage-page-store"
import type { MainAreaProps } from "@/hooks/use-app-shell-bundles"

const UsagePage = lazy(() => import("@/components/usage/usage-page"))

export function MainSurface(props: MainAreaProps) {
  const open = useUsagePageStore(state => state.open)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className={open ? "hidden" : "contents"}>
        <MainArea {...props} />
      </div>
      {open && <ErrorBoundary label="Usage">
        <Suspense fallback={<div className="m-auto text-sm text-muted-foreground" role="status">Loading usage…</div>}>
          <UsagePage onClose={() => {
            useUsagePageStore.getState().setOpen(false)
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-usage-nav]")?.focus())
          }} />
        </Suspense>
      </ErrorBoundary>}
    </div>
  )
}
