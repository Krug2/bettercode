import { RefreshCwIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePreferencesStore } from "@/lib/preferences-store"
import { localDate, dateLabel } from "./activity-data"
import { formatCost } from "./format"
import { useUsage } from "./use-usage"
import { UsageBlobGraph } from "./usage-blob-graph"
import { UsageActivity } from "./usage-activity"
import { UsageSummary, UsageInsights } from "./usage-summary"
import { UsageModelTable } from "./usage-model-table"
import { UsageSettingsButton } from "./usage-settings-button"
import "./usage-page.css"

export default function UsagePage({ onClose }: { onClose: () => void }) {
  const { data, error, loading, refresh } = useUsage()
  const hidden = usePreferencesStore(state => state.hiddenUsageBlocks)
  const today = data ? localDate(data.generatedAt, data.timeZone) : ""
  return (
    <main className="usage-page" aria-label="Usage" aria-busy={loading}>
      <div className="usage-page-inner">
        <header className="usage-page-header">
          <div>
            <h1>Usage</h1>
            <p>A closer look at your tokens, models, and activity.</p>
          </div>
          <div className="usage-actions">
            <UsageSettingsButton />
            <Button variant="ghost" size="icon-sm" aria-label="Refresh usage" disabled={loading} onClick={refresh}><RefreshCwIcon className="size-4" /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close usage" onClick={onClose}><XIcon className="size-4" /></Button>
          </div>
        </header>
        {error && <div className="usage-notice" role="alert">{data ? "Showing the last loaded usage. " : "Could not load usage. "}{error}<Button variant="link" size="sm" onClick={refresh}>Retry</Button></div>}
        {loading && !data && <div className="usage-loading" role="status">Loading your usage…</div>}
        {["summary", "blobs", "activity", "insights", "tools", "models", "details"].every(id => hidden.includes(id)) && <p className="usage-notice">All usage blocks are hidden. Open usage settings to turn them back on.</p>}
        {data && <>
          {!hidden.includes("summary") && <UsageSummary data={data} today={today} />}
          {!data.calls && <div className="usage-notice">Your usage starts here. Send a message to a connected model; recorded tokens and activity will appear automatically.</div>}
          {!hidden.includes("blobs") && <UsageBlobGraph models={data.models} />}
          {!hidden.includes("activity") && <UsageActivity days={data.days} today={today} />}
          <UsageInsights data={data} showInsights={!hidden.includes("insights")} showTools={!hidden.includes("tools")} />
          {!hidden.includes("models") && data.models.length > 0 && <UsageModelTable models={data.models} />}
          {!hidden.includes("details") && <footer className="usage-page-footer">
            <p>{data.calls.toLocaleString()} recorded responses{data.since ? ` since ${dateLabel(localDate(data.since, data.timeZone))}` : ""} · {data.cost === null ? "Spend not reported" : `${formatCost(data.cost)} reported spend (USD)`} · {data.timeZone}</p>
            <p>Based on retained conversation history. Costs appear only when reported by the provider; dashes mean unavailable. Account allowances and usage outside this app are not included.{data.unreported > 0 ? ` ${data.unreported.toLocaleString()} responses have incomplete token usage.` : ""}</p>
          </footer>}
        </>}
      </div>
    </main>
  )
}
