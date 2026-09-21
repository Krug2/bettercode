/**
 * User-facing wording for a workspace search the backend cut short.
 *
 * The backend caps every search walk (result count, visited entries, scanned
 * files/bytes, and a deadline) and reports which cap fired as
 * `truncatedReason`. Every surface that lists search results — file tree,
 * @-mention menu, search sidebar, references, symbols dialog, slash-command
 * output — says so with this one phrasing, so the same situation never reads
 * differently in two places. Pure so it is testable without a DOM.
 */

const REASON_LABELS: Record<string, string> = {
  // `/workspace/search` (entry walk)
  results: "result cap",
  visited: "entry cap",
  // `/workspace/search-content`
  limit: "match cap",
  files: "file cap",
  bytes: "size cap",
  // shared
  deadline: "time limit",
}

export function describeSearchTruncationReason(
  reason: string | undefined
): string {
  return (reason && REASON_LABELS[reason]) || "cap"
}

export interface SearchTruncationMessageInput {
  /** What was cut short, e.g. "Results", "File list", "Scan". */
  subject?: string
  reason?: string
  /** What the user can do about it. */
  hint?: string
}

export function searchTruncationMessage({
  subject = "Results",
  reason,
  hint = "narrow your search",
}: SearchTruncationMessageInput = {}): string {
  return `${subject} cut short (${describeSearchTruncationReason(reason)}) — ${hint}`
}
