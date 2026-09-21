/**
 * Encode/decode helpers for favorite-model identifiers.
 *
 * A favorite is a composite key "<providerId>::<modelId>" stored in
 * preferences. Using a dedicated separator (rather than `/` or `-`) avoids
 * collisions with provider or model ids that already contain those chars.
 */

export const FAVORITE_SEPARATOR = "::"

export function makeFavoriteKey(providerId: string, modelId: string): string {
  return `${providerId}${FAVORITE_SEPARATOR}${modelId}`
}

export function parseFavoriteKey(
  value: string
): { providerId: string; modelId: string } | null {
  const idx = value.indexOf(FAVORITE_SEPARATOR)
  if (idx <= 0) return null
  const providerId = value.slice(0, idx)
  const modelId = value.slice(idx + FAVORITE_SEPARATOR.length)
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}
