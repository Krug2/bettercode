import type { UsageDay } from "@betterc0de/schema"

export type ActivityMode = "daily" | "weekly" | "cumulative"
export const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
export const weekStart = (date: string) => shiftDate(date, -new Date(`${date}T00:00:00Z`).getUTCDay())
export const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

export function localDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(new Date(instant))
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-")
}

export function activityStats(days: UsageDay[], today: string) {
  const active = [...new Set(days.filter(day => day.calls > 0 && day.date <= today).map(day => day.date))].sort()
  const dates = new Set(active)
  let current = 0, longest = 0, run = 0, previous = ""
  for (const date of active) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }
  let cursor = dates.has(today) ? today : shiftDate(today, -1)
  while (dates.has(cursor)) { current++; cursor = shiftDate(cursor, -1) }
  const peak = days.filter(day => day.date <= today).reduce((max, day) => Math.max(max, day.tokens), 0)
  return { current, longest, peak }
}

export function activityCells(days: UsageDay[], today: string, mode: ActivityMode) {
  const start = shiftDate(weekStart(today), -52 * 7)
  const byDate = new Map(days.map(day => [day.date, day]))
  const weekly = new Map<string, number>()
  let cumulative = 0
  for (const day of days) {
    if (day.date > today) continue
    const week = weekStart(day.date)
    weekly.set(week, (weekly.get(week) ?? 0) + day.tokens)
    if (day.date < start) cumulative += day.tokens
  }
  return Array.from({ length: 53 * 7 }, (_, index) => {
    const date = shiftDate(start, index), day = byDate.get(date)
    cumulative += day?.tokens ?? 0
    return { date, future: date > today, tokens: day?.tokens ?? 0, calls: day?.calls ?? 0, cost: day?.cost ?? null, value: mode === "weekly" ? weekly.get(weekStart(date)) ?? 0 : mode === "cumulative" ? cumulative : day?.tokens ?? 0 }
  })
}
