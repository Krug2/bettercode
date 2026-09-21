/**
 * Reads one cookie value out of a raw `Cookie` request header.
 *
 * Shared by the HTTP auth path and the WebSocket upgrade path so both accept
 * exactly the same encoding. Returns `null` for a missing cookie and for a
 * value whose percent-encoding is malformed (never a partially decoded value).
 */
export function readCookie(
  cookieHeader: string | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=")
    if (index < 0) continue
    if (part.slice(0, index).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      return null
    }
  }
  return null
}
