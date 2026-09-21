const baseUrl = import.meta.env.BASE_URL || "/"

export function assetUrl(path: string): string {
  const trimmed = path.startsWith("/") ? path.slice(1) : path
  if (!baseUrl.endsWith("/")) return `${baseUrl}/${trimmed}`
  return `${baseUrl}${trimmed}`
}

export function toFileUrl(inputPath: string): string {
  if (!inputPath) return ""
  if (inputPath.startsWith("file://")) return inputPath
  const normalized = inputPath.replace(/\\/g, "/")
  if (normalized.startsWith("/")) return `file://${normalized}`
  return `file:///${normalized}`
}
