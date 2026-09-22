import { RefreshCwIcon } from "lucide-react"
import { useUsage } from "@/components/usage/use-usage"
import { localDate } from "@/components/usage/activity-data"
import { UsageBlobGraph } from "@/components/usage/usage-blob-graph"
import { UsageActivity } from "@/components/usage/usage-activity"
import { UsageSummary, UsageInsights } from "@/components/usage/usage-summary"
import { UsageModelTable } from "@/components/usage/usage-model-table"
import "@/components/usage/usage-page.css"

export default function WorkspaceUsage({ kind }: { kind: "usage" | "activity" }) {
  const { data, loading, error, refresh } = useUsage()
  const today = data ? localDate(data.generatedAt, data.timeZone) : ""
  return (
    <div className="usage-page workspace-usage" aria-busy={loading}>
      <div className="usage-page-inner">
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>Live usage from your retained conversations</span><button type="button" aria-label="Refresh usage" disabled={loading} onClick={refresh} className="rounded p-1 hover:bg-muted"><RefreshCwIcon size={14} /></button></div>
        {error && <p role="alert" className="usage-notice">{error}</p>}
        {loading && !data && <p role="status">Loading usage…</p>}
        {data && (kind === "usage" ? <UsageBlobGraph models={data.models} /> : <>
          <UsageSummary data={data} today={today} />
          <UsageActivity days={data.days} today={today} />
          <UsageInsights data={data} />
          {data.models.length > 0 && <UsageModelTable models={data.models} />}
        </>)}
      </div>
    </div>
  )
}
