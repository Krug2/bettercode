import type { CodeOutlineItem } from "@/lib/code-outline"

const DEFAULT_DOCUMENT_SYMBOL_LIMIT = 80

export function filterDocumentSymbols(
  outline: readonly CodeOutlineItem[],
  query: string,
  limit = DEFAULT_DOCUMENT_SYMBOL_LIMIT
): CodeOutlineItem[] {
  const normalizedQuery = normalizeSymbolSearchText(query)
  const boundedLimit = Math.max(1, Math.floor(limit))
  if (!normalizedQuery) return outline.slice(0, boundedLimit)

  const tokens = normalizedQuery.split(/\s+/g).filter(Boolean)
  return outline
    .map((item) => ({ item, score: scoreDocumentSymbol(item, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (left.item.line !== right.item.line)
        return left.item.line - right.item.line
      return left.item.name.localeCompare(right.item.name)
    })
    .slice(0, boundedLimit)
    .map((entry) => entry.item)
}

function scoreDocumentSymbol(
  item: CodeOutlineItem,
  tokens: readonly string[]
): number {
  const name = normalizeSymbolSearchText(item.name)
  const kind = normalizeSymbolSearchText(item.kind)
  const detail = normalizeSymbolSearchText(item.detail ?? "")
  let score = Math.max(0, 18 - item.depth * 2)

  for (const token of tokens) {
    if (name === token) {
      score += 120
      continue
    }
    if (name.startsWith(token)) {
      score += 80
      continue
    }
    if (name.includes(token)) {
      score += 52
      continue
    }
    if (detail.includes(token)) {
      score += 26
      continue
    }
    if (kind.includes(token)) {
      score += 16
      continue
    }
    return 0
  }

  return score
}

function normalizeSymbolSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ")
}
