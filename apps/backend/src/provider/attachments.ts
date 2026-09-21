import type { ProviderAttachment } from "./types"

export interface ParsedDataUrl {
  mediaType: string
  base64: string
}

export function parseBase64DataUrl(url: string): ParsedDataUrl | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (!match) return null
  const mediaType = match[1]?.trim().toLowerCase()
  const base64 = match[2] ?? ""
  if (!mediaType || !base64) return null
  return { mediaType, base64 }
}

export function attachmentMediaType(
  attachment: Pick<ProviderAttachment, "mediaType" | "url">
): string {
  const explicit = attachment.mediaType?.trim().toLowerCase()
  if (explicit) return explicit
  return parseBase64DataUrl(attachment.url)?.mediaType ?? "application/octet-stream"
}

export function imageAttachments(
  attachments: readonly ProviderAttachment[] | undefined
): ProviderAttachment[] {
  return (attachments ?? []).filter((attachment) =>
    attachmentMediaType(attachment).startsWith("image/")
  )
}

export function attachmentName(attachment: ProviderAttachment): string {
  return attachment.filename?.trim() || "attachment"
}

export function buildUnsupportedAttachmentNotice(
  attachments: readonly ProviderAttachment[] | undefined
): string | null {
  const list = attachments ?? []
  if (list.length === 0) return null
  return [
    "",
    "",
    "Attached files:",
    ...list.map((attachment) => {
      const parsed = parseBase64DataUrl(attachment.url)
      const bytes = parsed ? Buffer.byteLength(parsed.base64, "utf8") : 0
      return `- ${attachmentName(attachment)} (${attachmentMediaType(attachment)}${bytes > 0 ? `, ${bytes} base64 bytes` : ""})`
    }),
    "",
    "This provider path does not expose a structured attachment channel yet. Ask the user to switch to BetterC0de Compat, Claude API, or OpenAI API for native image input if the file content is required.",
  ].join("\n")
}
