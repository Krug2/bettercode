import { RefreshCwIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { localDate, dateLabel } from "./activity-data"
import { formatCost } from "./format"
import { useUsage } from "./use-usage"
import { UsageBlobGraph } from "./usage-blob-graph"
import { UsageActivity } from "./usage-activity"
import { UsageSummary, UsageInsights } from "./usage-summary"
import { UsageModelTable } from "./usage-model-table"
import "./usage-page.css"

export default function UsagePage({ onClose }: { onClose: () => void }) {
  const { data, error, loading, refresh } = useUsage()
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
            <Button variant="ghost" size="icon-sm" aria-label="Refresh usage" disabled={loading} onClick={refresh}><RefreshCwIcon className="size-4" /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close usage" onClick={onClose}><XIcon className="size-4" /></Button>
          </div>
        </header>
        {error && <div className="usage-notice" role="alert">{data ? "Showing the last loaded usage. " : "Could not load usage. "}{error}<Button variant="link" size="sm" onClick={refresh}>Retry</Button></div>}
        {loading && !data && <div className="usage-loading" role="status">Loading your usage…</div>}
        {data && <>
          <UsageSummary data={data} today={today} />
          {!data.calls && <div className="usage-notice">Your usage starts here. Send a message to a connected model; recorded tokens and activity will appear automatically.</div>}
          <UsageBlobGraph models={data.models} />
          <UsageActivity days={data.days} today={today} />
          <UsageInsights data={data} />
          {data.models.length > 0 && <UsageModelTable models={data.models} />}
          <footer className="usage-page-footer">
            <p>{data.calls.toLocaleString()} recorded responses{data.since ? ` since ${dateLabel(data.since)}` : ""} · {data.cost === null ? "Spend not reported" : `${formatCost(data.cost)} reported spend (USD)`} · {data.timeZone}</p>
            <p>Based on retained conversation history. Costs appear only when reported by the provider; dashes mean unavailable. Account allowances and usage outside this app are not included.{data.unreported > 0 ? ` ${data.unreported.toLocaleString()} responses have incomplete token usage.` : ""}</p>
          </footer>
        </>}
      </div>
    </main>
  )
}
