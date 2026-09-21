import type { ProviderInstanceStatus } from "@betterc0de/schema"
import { formatProviderActivityLabel } from "@/lib/provider-label"

export type ProviderStatusBannerInput = {
  id?: string | null
  name?: string | null
  providerKind?: string | null
  providerInstanceId?: string | null
  configured?: boolean
  status?: ProviderInstanceStatus | null
  statusMessage?: string | null
  setupHint?: string | null
  unavailableReason?: string | null
}

export type ProviderStatusBannerView = {
  readonly tone: "warning" | "error"
  readonly status: Exclude<ProviderInstanceStatus, "ready" | "disabled">
  readonly providerLabel: string
  readonly title: string
  readonly message: string
}

export function getProviderStatusBannerView(
  provider: ProviderStatusBannerInput | null | undefined
): ProviderStatusBannerView | null {
  if (!provider) return null
  const status = resolveProviderStatus(provider)
  if (status === "ready" || status === "disabled") return null

  const providerLabel = resolveProviderLabel(provider)
  const fallbackMessage =
    status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`
  const message =
    provider.statusMessage?.trim() ||
    provider.unavailableReason?.trim() ||
    provider.setupHint?.trim() ||
    fallbackMessage

  return {
    tone: status === "error" ? "error" : "warning",
    status,
    providerLabel,
    title: `${providerLabel} provider status`,
    message,
  }
}

function resolveProviderStatus(
  provider: ProviderStatusBannerInput
): ProviderInstanceStatus {
  if (provider.status) return provider.status
  return provider.configured === false ? "warning" : "ready"
}

function resolveProviderLabel(provider: ProviderStatusBannerInput): string {
  const name = provider.name?.trim()
  if (name) return name
  return formatProviderActivityLabel(
    {
      providerKind: provider.providerKind,
      providerInstanceId: provider.providerInstanceId ?? provider.id,
    },
    "Provider"
  )
}
