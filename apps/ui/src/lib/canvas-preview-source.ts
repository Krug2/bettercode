/** Persist the user's choice, never an ephemeral desktop preview grant URL. */
export type CanvasPreviewSource =
  | { kind: "server" }
  | { kind: "url"; url: string }
  | { kind: "html"; relativePath: string }

export type HtmlPreviewResult =
  | { status: "cancelled" }
  | { status: "ready"; relativePath: string; url: string }

export function normalizePreviewUrl(input: string): string | null {
  const text = input.trim()
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text))
    return null
  if (!text || /^(?:file|javascript|data|betterc0de-html):/i.test(text))
    return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null
    return url.href
  } catch {
    return null
  }
}

/** Settings are restored from disk; don't trust an old or malformed saved shape. */
export function readPreviewSource(
  value: unknown,
  legacyUrl?: unknown
): CanvasPreviewSource {
  if (value && typeof value === "object" && "kind" in value) {
    if (value.kind === "server") return { kind: "server" }
    if (
      value.kind === "url" &&
      "url" in value &&
      typeof value.url === "string"
    ) {
      const url = normalizePreviewUrl(value.url)
      if (url) return { kind: "url", url }
    }
    if (
      value.kind === "html" &&
      "relativePath" in value &&
      typeof value.relativePath === "string" &&
      value.relativePath
    ) {
      return { kind: "html", relativePath: value.relativePath }
    }
  }
  const url =
    typeof legacyUrl === "string" ? normalizePreviewUrl(legacyUrl) : null
  return url ? { kind: "url", url } : { kind: "server" }
}
