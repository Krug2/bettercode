export const formatTokens = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value)

export const formatCost = (value: number | null) => value === null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2 }).format(value)

export function formatDuration(value: number | null): string {
  if (value === null) return "—"
  const minutes = Math.floor(value / 60_000)
  if (minutes < 1) return "<1m"
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
