export function previewUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null
  } catch {
    return null
  }
}

export function previewTabLabel(value: string): string {
  const url = previewUrl(value)
  return url ? new URL(url).host : "Browser"
}
