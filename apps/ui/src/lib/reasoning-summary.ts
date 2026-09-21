const MAX_REASONING_SUMMARY_LENGTH = 120

export function buildReasoningSummary(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (!normalized) return null

  const htmlHeading = normalized.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (htmlHeading?.[1]) {
    const value = cleanReasoningSummary(htmlHeading[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atxHeading = normalized.match(
    /^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m
  )
  if (atxHeading?.[1]) {
    const value = cleanReasoningSummary(atxHeading[1])
    if (value) return value
  }

  const firstUsefulLine = normalized
    .split("\n")
    .map((line) => cleanReasoningSummary(line))
    .find(Boolean)
  return firstUsefulLine ?? null
}

function cleanReasoningSummary(value: string): string | null {
  const cleaned = value
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null
  if (cleaned.length <= MAX_REASONING_SUMMARY_LENGTH) return cleaned
  return `${cleaned.slice(0, MAX_REASONING_SUMMARY_LENGTH - 1).trimEnd()}…`
}
