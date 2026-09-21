/**
 * Small formatting helpers used across the UI.
 *
 * These are pure functions with no store/DOM dependencies — safe to import
 * from anywhere.
 */

/** HH:MM (locale-aware). Returns empty string if the input is unparseable. */
export function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

/** Short human-readable token count: 1234 → "1.2k", 1_500_000 → "1.5m". */
export function formatTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "0"
  if (value < 1_000) return `${Math.round(value)}`
  if (value < 10_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
}

/** "5s ago" / "12m ago" / "3h ago" / "2d ago". */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
