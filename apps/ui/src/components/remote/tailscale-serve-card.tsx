import { Check, LoaderCircle, TriangleAlert } from "lucide-react"
import { SettingsRow } from "@/components/settings/atoms"
import { Switch } from "@/components/ui/switch"
import {
  describeTailscaleConnection,
  describeTailscaleServe,
  type TailscaleSummary,
} from "@/lib/tailscale-serve"
import type { TailscaleRemoteStatus } from "@/services/backend/remoteApi"

function SummaryBadge({ summary }: { summary: TailscaleSummary }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        summary.tone === "ok"
          ? "text-emerald-500"
          : summary.tone === "warn"
            ? "text-amber-500"
            : "text-muted-foreground"
      }`}
    >
      {summary.tone === "ok" ? (
        <Check className="size-3.5" />
      ) : summary.tone === "warn" ? (
        <TriangleAlert className="size-3.5" />
      ) : null}
      {summary.headline}
    </span>
  )
}

/**
 * Two rows: the tailnet connection (zero-config, the path a phone uses) and
 * the optional Serve/HTTPS add-on with its switch.
 */
export function TailscaleServeCard({
  status,
  hostingEnabled,
  busy,
  disabled,
  onToggle,
}: {
  status: TailscaleRemoteStatus | null
  hostingEnabled: boolean
  busy: boolean
  /** Paired browsers see the state but cannot flip it. */
  disabled: boolean
  onToggle: (enabled: boolean) => void
}) {
  const connection = describeTailscaleConnection(status, hostingEnabled)
  const serve = describeTailscaleServe(status, hostingEnabled)
  const checked = status?.serveEnabled === true
  return (
    <div
      data-tailscale-connection={connection.tone}
      data-tailscale-serve={serve.tone}
      data-serve-enabled={checked}
    >
      <SettingsRow label="Tailnet" description={connection.detail}>
        <SummaryBadge summary={connection} />
      </SettingsRow>
      <SettingsRow
        label="Serve over Tailscale HTTPS"
        description={serve.detail}
      >
        <div className="flex items-center gap-2">
          <SummaryBadge summary={serve} />
          {busy ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          <Switch
            aria-label="Serve over Tailscale HTTPS"
            checked={checked}
            disabled={disabled || busy || !serve.canToggle}
            onCheckedChange={onToggle}
          />
        </div>
      </SettingsRow>
    </div>
  )
}
