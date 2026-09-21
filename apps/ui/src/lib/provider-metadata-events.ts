export const PROVIDER_METADATA_CHANGED_EVENT =
  "betterc0de:provider-metadata-changed"

export interface ProviderMetadataChangedDetail {
  readonly providerKind?: string
  readonly providerInstanceId?: string
  readonly metadataKind?: string
  readonly cwd?: string | null
}

export function dispatchProviderMetadataChanged(
  detail: ProviderMetadataChangedDetail
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(PROVIDER_METADATA_CHANGED_EVENT, { detail })
  )
}
