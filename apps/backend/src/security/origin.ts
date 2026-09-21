const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

/**
 * Browser-origin policy for the loopback backend. Requests without Origin
 * are non-browser clients and remain token-gated. Electron's packaged file
 * renderer serializes to `null`/`file://`; arbitrary pages still lack the
 * bearer because only trusted Electron webContents receive it.
 */
export function isAllowedBrowserOrigin(
  origin: string | undefined,
  configuredOrigins: readonly string[] = [],
  context: {
    /** HTTP Host header for a backend-served, same-origin web client. */
    requestHost?: string
    /** Enabled only when network access was explicitly turned on. */
    allowSameHost?: boolean
    /** Only a request already authenticated with the private process bearer. */
    allowLoopback?: boolean
    /** Packaged Electron's opaque file origin, gated by the process bearer. */
    allowOpaque?: boolean
  } = {},
): boolean {
  if (origin === undefined) return true
  const candidate = origin.trim()
  if (candidate === "null" || candidate === "file://") {
    return context.allowOpaque === true
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return false
  }

  if (
    context.allowLoopback === true &&
    (parsed.protocol === "http:" || parsed.protocol === "https:")
    && isLoopbackHostname(parsed.hostname)
  ) {
    return true
  }

  if (
    context.allowSameHost &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    typeof context.requestHost === "string" &&
    context.requestHost.trim().toLowerCase() === parsed.host.toLowerCase()
  ) {
    return true
  }

  return configuredOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === parsed.origin
    } catch {
      return false
    }
  })
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().replace(/^\[|\]$/g, "").toLowerCase())
}
