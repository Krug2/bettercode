import { RefreshCwIcon } from "lucide-react"
import { usePreferencesStore } from "@/lib/preferences-store"
import { useUsage } from "@/components/usage/use-usage"
import { localDate } from "@/components/usage/activity-data"
import { UsageBlobGraph } from "@/components/usage/usage-blob-graph"
import { UsageActivity } from "@/components/usage/usage-activity"
import { UsageSummary, UsageInsights } from "@/components/usage/usage-summary"
import { UsageModelTable } from "@/components/usage/usage-model-table"
import { UsageSettingsButton } from "@/components/usage/usage-settings-button"
import "@/components/usage/usage-page.css"

export default function WorkspaceUsage({ kind }: { kind: "usage" | "activity" }) {
  const { data, loading, error, refresh } = useUsage()
  const hidden = usePreferencesStore(state => state.hiddenUsageBlocks)
  const empty = (kind === "usage" ? ["blobs"] : ["summary", "activity", "insights", "tools", "models"]).every(id => hidden.includes(id))
  const today = data ? localDate(data.generatedAt, data.timeZone) : ""
  return (
    <div className="usage-page workspace-usage" aria-busy={loading}>
      <div className="usage-page-inner">
        <div className="flex shrink-0 items-center justify-between gap-4 text-xs text-muted-foreground"><span>Live usage from your retained conversations</span><div className="usage-actions"><UsageSettingsButton /><button type="button" aria-label="Refresh usage" disabled={loading} onClick={refresh} className="rounded p-1 hover:bg-muted"><RefreshCwIcon size={14} /></button></div></div>
        {error && <p role="alert" className="usage-notice">{error}</p>}
        {loading && !data && <p role="status">Loading usage…</p>}
        {empty && <p className="usage-notice">The blocks in this window are hidden. Open usage settings to turn them back on.</p>}
        {data && (kind === "usage" ? !hidden.includes("blobs") && <UsageBlobGraph models={data.models} /> : <>
          {!hidden.includes("summary") && <UsageSummary data={data} today={today} />}
          {!hidden.includes("activity") && <UsageActivity days={data.days} today={today} />}
          <UsageInsights data={data} showInsights={!hidden.includes("insights")} showTools={!hidden.includes("tools")} />
          {!hidden.includes("models") && data.models.length > 0 && <UsageModelTable models={data.models} />}
        </>)}
      </div>
    </div>
  )
}
