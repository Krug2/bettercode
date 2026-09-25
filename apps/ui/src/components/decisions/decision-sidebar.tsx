import { useEffect, useState } from "react"
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Cpu,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
} from "lucide-react"
import type {
  DecisionRecord,
  DecisionSettings,
  DecisionSnapshot,
} from "@betterc0de/schema"
import { useSettingsStore } from "@/lib/settings-store"
import { useDecisions } from "./use-decisions"
import "./decisions.css"

const labels = {
  route: "Worker routing",
  context: "Shared context",
  recovery: "Recovery suggestion",
}
const number = (value: number) =>
  Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)

export function DecisionSidebar({
  threadId,
  connected,
}: {
  threadId: string
  connected: boolean
}) {
  const { snapshot, error, retry } = useDecisions(threadId, connected)
  const settings = useSettingsStore((state) => state.decisionLayer)
  return (
    <DecisionPanel
      snapshot={snapshot}
      connected={connected}
      settings={settings}
      error={error}
      onRetry={retry}
    />
  )
}

export function DecisionPanel({
  snapshot,
  connected,
  settings,
  error,
  onRetry,
}: {
  snapshot: DecisionSnapshot
  connected: boolean
  settings: DecisionSettings
  error: string | null
  onRetry: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [filter, setFilter] = useState<"all" | "fallback">("all")
  const [now, setNow] = useState(Date.now())
  const pending = snapshot.records.filter(
    (record) => record.status === "deciding"
  )
  const active = pending.length > 0 && connected
  const completedCalls = Math.max(0, snapshot.calls - pending.length)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [active])
  if (collapsed)
    return (
      <aside className="decision-rail">
        <button
          type="button"
          title="Show decisions"
          aria-label="Show decisions"
          onClick={() => setCollapsed(false)}
        >
          <PanelRightOpen size={16} />
        </button>
      </aside>
    )
  const records = snapshot.records
    .filter(
      (record) =>
        filter === "all" ||
        record.status === "fallback" ||
        record.status === "cancelled"
    )
    .slice()
    .reverse()
  const elapsed = pending.length
    ? Math.max(0, now - Date.parse(pending[0]!.createdAt))
    : (snapshot.records.at(-1)?.elapsedMs ?? 0)
  return (
    <aside className="decision-panel" aria-label="Live decisions">
      <header className="decision-header">
        <span className="decision-mark">
          <Cpu size={17} />
        </span>
        <div>
          <h2>
            {settings.mode === "jev"
              ? "Jev"
              : settings.mode === "local"
                ? "Local selector"
                : "Decisions"}
          </h2>
          <span>Alongside your main model</span>
        </div>
        <button
          type="button"
          aria-label="Hide decisions"
          title="Hide decisions"
          onClick={() => setCollapsed(true)}
        >
          <PanelRightClose size={15} />
        </button>
      </header>
      <div className="decision-pulse" role="status">
        <span className={active ? "decision-dot is-active" : "decision-dot"} />
        <span>
          {!connected
            ? "Reconnecting"
            : active
              ? "Choosing the next step"
              : "Ready when needed"}
        </span>
        <span className="decision-live">{connected ? "live" : "offline"}</span>
      </div>
      <section className="decision-metrics" aria-label="Decision metrics">
        <div className="decision-timer">
          <span>
            <Clock3 size={12} />
            {pending.length ? "Current decision" : "Last decision"}
          </span>
          <strong>
            {(elapsed / 1000).toFixed(2)}
            <small>s</small>
          </strong>
        </div>
        <div className="decision-metric-grid">
          <Metric label="Selector calls" value={number(snapshot.calls)} />
          <Metric
            label="Reported tokens"
            value={number(snapshot.inputTokens + snapshot.outputTokens)}
          />
          <Metric label="Selections" value={number(snapshot.selected)} />
          <Metric label="Fallbacks" value={number(snapshot.fallbacks)} />
        </div>
        <div className="decision-token-line">
          <span>{number(snapshot.inputTokens)} in</span>
          <span>{number(snapshot.outputTokens)} out</span>
          <span>
            {completedCalls
              ? `${Math.round(snapshot.elapsedMs / completedCalls)} ms avg`
              : "No calls yet"}
          </span>
        </div>
        {snapshot.unreported > 0 && (
          <p className="decision-note">
            Usage unavailable for {snapshot.unreported}{" "}
            {snapshot.unreported === 1 ? "call" : "calls"}.
          </p>
        )}
        <div
          className="decision-sparkline"
          aria-label="Recent decision latency"
        >
          {snapshot.records.slice(-32).map((record) => (
            <span
              key={record.id}
              className={record.status === "selected" ? "is-selected" : ""}
              style={{
                height: `${Math.max(6, Math.min(100, (record.elapsedMs / settings.timeoutMs) * 100))}%`,
              }}
              title={`${labels[record.kind]}: ${record.elapsedMs} ms`}
            />
          ))}
        </div>
      </section>
      <div className="decision-stream-heading">
        <h3>Decision stream</h3>
        <select
          aria-label="Filter decisions"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="all">All decisions</option>
          <option value="fallback">Fallbacks</option>
        </select>
      </div>
      {error && (
        <div className="decision-error" role="alert">
          {error}
          <button type="button" onClick={onRetry}>
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      )}
      <div className="decision-stream">
        {!records.length ? (
          <div className="decision-empty">
            <Activity size={25} />
            <h3>
              {filter === "fallback" ? "No fallbacks" : "A quieter way to work"}
            </h3>
            <p>
              {filter === "fallback"
                ? "Uncertain or unavailable choices appear here."
                : "Enable workers in + → Orchestration, then send a task. Routes and shared-context choices appear here as they happen."}
            </p>
          </div>
        ) : (
          records.map((record) => (
            <DecisionCard
              key={record.id}
              record={record}
              connected={connected}
            />
          ))
        )}
      </div>
      <footer className="decision-footer">
        Your main model handles reasoning and approvals.
      </footer>
    </aside>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DecisionCard({
  record,
  connected,
}: {
  record: DecisionRecord
  connected: boolean
}) {
  const selected = record.candidates.find(
    (candidate) => candidate.id === record.choice
  )
  const status =
    record.status === "deciding"
      ? connected
        ? "Choosing"
        : "Awaiting reconnect"
      : record.status === "selected"
        ? "Selected"
        : record.status === "cancelled"
          ? "Cancelled"
          : "Main model"
  return (
    <details className={`decision-card decision-${record.status}`}>
      <summary>
        <span className="decision-card-icon">
          {record.status === "selected" ? (
            <Check size={13} />
          ) : record.status === "deciding" ? (
            <Activity size={13} />
          ) : (
            <ArrowRight size={13} />
          )}
        </span>
        <span className="decision-card-title">
          <span>{labels[record.kind]}</span>
          <strong>
            {selected?.label ?? record.reason ?? "Comparing eligible options"}
          </strong>
          <span className="decision-card-meta">
            <span>{status}</span>
            <span>{record.elapsedMs} ms</span>
            {record.confidence !== null && (
              <span>{Math.round(record.confidence * 100)}% confidence</span>
            )}
          </span>
        </span>
        <ChevronDown size={12} className="decision-chevron" />
      </summary>
      <div className="decision-details">
        <p>{record.model || "No model configured"}</p>
        <ul>
          {record.candidates.map((candidate) => (
            <li
              key={candidate.id}
              className={candidate.id === record.choice ? "is-picked" : ""}
            >
              {candidate.id === record.choice && <Check size={11} />}
              {candidate.label}
            </li>
          ))}
        </ul>
        <p>
          {record.inputTokens === null
            ? "Input usage unavailable"
            : `${record.inputTokens} input tokens`}{" "}
          ·{" "}
          {record.outputTokens === null
            ? "output unavailable"
            : `${record.outputTokens} output tokens`}
        </p>
      </div>
    </details>
  )
}
