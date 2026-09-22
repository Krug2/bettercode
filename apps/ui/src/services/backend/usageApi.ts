import type { UsageDashboard } from "@betterc0de/schema"
import { invoke } from "./runtime"

export async function getUsageDashboard(signal?: AbortSignal): Promise<UsageDashboard> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const data = await invoke<unknown>(`/usage?timeZone=${encodeURIComponent(timeZone)}`, { signal })
  const { usageDashboardSchema } = await import("@betterc0de/schema")
  return usageDashboardSchema.parse(data)
}
