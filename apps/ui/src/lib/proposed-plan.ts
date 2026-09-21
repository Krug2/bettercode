const headingPattern = /^\s{0,3}#{1,6}\s+(.+)$/m

function headingText(markdown: string): string | null {
  const capture = headingPattern.exec(markdown)
  return capture?.[1]?.trim() || null
}

export function proposedPlanTitle(markdown: string): string | null {
  return headingText(markdown)
}

/** Keep the document intact; the preview only selects a range of its rows. */
function bodyRows(markdown: string): string[] {
  const rows = markdown.trimEnd().split(/\r?\n/)
  let start = /^\s{0,3}#{1,6}\s+/.test(rows[0] ?? "") ? 1 : 0
  const skipSpace = () => {
    while (start < rows.length && !rows[start]!.trim()) start++
  }
  skipSpace()
  if (headingText(rows[start] ?? "")?.toLowerCase() === "summary") {
    start++
    skipSpace()
  }
  return rows.slice(start)
}

export function stripDisplayedPlanMarkdown(markdown: string): string {
  return bodyRows(markdown).join("\n")
}

export function buildCollapsedProposedPlanPreviewMarkdown(
  markdown: string,
  options?: { maxLines?: number },
): string {
  const rows = bodyRows(markdown).map(row => row.trimEnd())
  const contentRows = rows.flatMap((row, index) => row.trim() ? [index] : [])
  const budget = options?.maxLines ?? 8
  const omitted = contentRows.findIndex((_, index) => index >= budget)
  const boundary = omitted < 0 ? rows.length : contentRows[omitted]!
  const preview = rows.slice(0, boundary).join("\n").trimEnd()
  if (!preview) return headingText(markdown) ?? "Plan preview unavailable."
  return omitted < 0 ? preview : `${preview}\n\n...`
}

export function shouldCollapseProposedPlan(
  markdown: string,
  options?: { maxLength?: number; maxLines?: number },
): boolean {
  if (markdown.length > (options?.maxLength ?? 900)) return true
  const newlineCount = markdown.match(/\n/g)?.length ?? 0
  return newlineCount + 1 > (options?.maxLines ?? 20)
}

export function buildPlanImplementationPrompt(markdown: string): string {
  return ["PLEASE IMPLEMENT THIS PLAN:", markdown.trim()].join("\n")
}

export function resolvePlanFollowUpSubmission(input: {
  draftText: string
  planMarkdown: string
}): { text: string; interactionMode: "default" | "plan" } {
  const feedback = input.draftText.trim()
  return feedback
    ? { interactionMode: "plan", text: feedback }
    : { interactionMode: "default", text: buildPlanImplementationPrompt(input.planMarkdown) }
}

export function buildPlanImplementationThreadTitle(markdown: string): string {
  return `Implement ${headingText(markdown) ?? "plan"}`
}

export function buildProposedPlanMarkdownFilename(markdown: string): string {
  const title = (headingText(markdown) ?? "plan").toLowerCase()
  const fragments: string[] = []
  let word = ""
  for (const character of title) {
    if (/[`'".,!?()[\]{}]/.test(character)) continue
    if (/[a-z0-9]/.test(character)) word += character
    else if (word) { fragments.push(word); word = "" }
  }
  if (word) fragments.push(word)
  return `${fragments.join("-") || "plan"}.md`
}

export function normalizePlanMarkdownForExport(markdown: string): string {
  return markdown.trimEnd().concat("\n")
}

export function downloadPlanAsTextFile(filename: string, contents: string): void {
  const link = Object.assign(document.createElement("a"), {
    download: filename,
    href: URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" })),
  })
  try { link.click() }
  finally { window.setTimeout(() => URL.revokeObjectURL(link.href), 0) }
}
