import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { UsageDay } from "@betterc0de/schema"
import { activityCells, dateLabel, shiftDate, type ActivityMode } from "./activity-data"
import { formatCost, formatTokens } from "./format"

export function UsageActivity({ days, today }: { days: UsageDay[]; today: string }) {
  const [mode, setMode] = useState<ActivityMode>("daily")
  const [selected, setSelected] = useState(today)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const cells = useMemo(() => activityCells(days, today, mode), [days, today, mode])
  const max = Math.max(1, ...cells.filter(cell => !cell.future).map(cell => cell.value))
  const current = cells.find(cell => cell.date === selected) ?? cells.find(cell => cell.date === today)!
  const level = (value: number) => value === 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(value / max) * 4))
  const description = mode === "weekly" ? "tokens this week" : mode === "cumulative" ? "tokens through this day" : "tokens"
  const focusDate = (date: string) => {
    const next = date < cells[0].date ? cells[0].date : date > today ? today : date
    setSelected(next)
    buttons.current.get(next)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent, date: string) => {
    const offset: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    if (event.key in offset) { event.preventDefault(); focusDate(shiftDate(date, offset[event.key])) }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); focusDate(event.key === "Home" ? cells[0].date : today) }
  }

  return (
    <section aria-labelledby="usage-activity-title" className="usage-activity">
      <div className="usage-section-heading">
        <h2 id="usage-activity-title">Token activity</h2>
        <div className="usage-segments" aria-label="Activity scale">
          {(["daily", "weekly", "cumulative"] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value}</button>)}
        </div>
      </div>
      <div className="usage-calendar-scroll">
        <div className="usage-calendar" aria-label="Token activity by date">
          {cells.map((cell, index) => (
            <button
              key={cell.date}
              type="button"
              className="usage-day"
              data-level={level(cell.value)}
              data-future={cell.future || undefined}
              disabled={cell.future}
              tabIndex={cell.date === current.date ? 0 : -1}
              aria-label={`${dateLabel(cell.date)}: ${cell.value.toLocaleString()} ${description}`}
              aria-pressed={cell.date === current.date}
              ref={element => { if (element) buttons.current.set(cell.date, element); else buttons.current.delete(cell.date) }}
              onClick={() => setSelected(cell.date)}
              onFocus={() => setSelected(cell.date)}
              onKeyDown={event => onKeyDown(event, cell.date)}
            >
              <span className={`usage-day-tooltip${index < 28 ? " usage-tooltip-start" : index > 342 ? " usage-tooltip-end" : ""}`}>{formatTokens(cell.value)} {description} · {dateLabel(cell.date)}</span>
            </button>
          ))}
        </div>
        <div className="usage-months" aria-hidden="true">
          {Array.from({ length: 53 }, (_, index) => {
            const date = cells[index * 7].date
            const label = index === 0 || date.slice(0, 7) !== cells[(index - 1) * 7].date.slice(0, 7)
            return <span key={date}>{label ? new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : ""}</span>
          })}
        </div>
      </div>
      <div className="usage-activity-detail">
        <p aria-live="polite"><strong>{dateLabel(current.date)}</strong><span>{formatTokens(current.tokens)} tokens · {current.calls} responses · {current.cost === null ? "spend not reported" : `${formatCost(current.cost)} reported`}</span></p>
        <div className="usage-legend" aria-label="Heatmap intensity, less to more"><span>Less</span>{[0, 1, 2, 3, 4].map(value => <i key={value} data-level={value} />)}<span>More</span></div>
      </div>
    </section>
  )
}
