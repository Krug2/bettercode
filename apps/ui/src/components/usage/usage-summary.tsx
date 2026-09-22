import type { UsageDashboard } from "@betterc0de/schema"
import { activityStats } from "./activity-data"
import { formatDuration, formatTokens } from "./format"

export function UsageSummary({ data, today }: { data: UsageDashboard; today: string }) {
  const activity = activityStats(data.days, today)
  const metrics = [
    { label: "Recorded tokens", value: formatTokens(data.tokens), hint: "Input and output tokens in retained conversation history" },
    { label: "Peak day", value: formatTokens(activity.peak), hint: "Most recorded tokens in one calendar day" },
    { label: "Longest chat", value: formatDuration(data.longestChatMs), hint: "Combined completed turn time in one conversation" },
    { label: "Current streak", value: `${activity.current} ${activity.current === 1 ? "day" : "days"}`, hint: "Consecutive days with recorded responses, including yesterday if today is still quiet" },
    { label: "Longest streak", value: `${activity.longest} ${activity.longest === 1 ? "day" : "days"}`, hint: "Longest run of days with recorded responses" },
  ]
  return <dl className="usage-summary">{metrics.map(metric => <div key={metric.label} title={metric.hint}><dd>{metric.value}</dd><dt>{metric.label}</dt></div>)}</dl>
}

export function UsageInsights({ data }: { data: UsageDashboard }) {
  const percent = (value: number | null) => value === null ? "Not recorded" : new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 }).format(value)
  return (
    <div className="usage-insights">
      <section aria-labelledby="usage-insights-title">
        <h2 id="usage-insights-title">Activity insights</h2>
        <dl>
          <div><dt>Fast mode</dt><dd>{percent(data.fastModeShare)}</dd></div>
          <div><dt>Most used reasoning</dt><dd>{data.reasoning ? `${data.reasoning.label} · ${percent(data.reasoning.share)}` : "Not recorded"}</dd></div>
          <div><dt>Skills explored</dt><dd>{data.skills ?? "Not recorded"}</dd></div>
        </dl>
      </section>
      <section aria-labelledby="usage-tools-title">
        <h2 id="usage-tools-title">Most used tools & plugins</h2>
        {data.tools.length ? <ol>{data.tools.slice(0, 5).map(tool => <li key={tool.name}><span title={tool.name}>{tool.name}</span><span>{tool.runs.toLocaleString()} {tool.runs === 1 ? "run" : "runs"}</span></li>)}</ol> : <p className="usage-empty-insight">Tool activity will appear here as it is recorded.</p>}
      </section>
    </div>
  )
}
