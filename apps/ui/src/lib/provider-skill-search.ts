import type { ProviderSkill } from "@betterc0de/schema"
import { formatProviderSkillDisplayName } from "@/lib/provider-skill-presentation"

interface RankedSkill {
  readonly item: ProviderSkill
  readonly score: number
  readonly tieBreaker: string
}

type MatchWeights = readonly [
  exact: number, prefix: number, boundary: number | undefined, substring: number, fuzzy?: number,
]

export function searchProviderSkills(
  skills: ReadonlyArray<ProviderSkill>,
  query: string,
  limit = Number.POSITIVE_INFINITY
): ProviderSkill[] {
  const enabledSkills = skills.filter((skill) => skill.enabled)
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return enabledSkills.slice(0, limit)

  const ranked: RankedSkill[] = []
  for (const skill of enabledSkills) {
    const score = scoreProviderSkill(skill, normalizedQuery)
    if (score === null) continue
    ranked.push({
      item: skill,
      score,
      tieBreaker: `${formatProviderSkillDisplayName(skill).toLowerCase()}\u0000${skill.name}`,
    })
  }

  return ranked
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score
      return left.tieBreaker.localeCompare(right.tieBreaker)
    })
    .slice(0, limit)
    .map((entry) => entry.item)
}

function scoreProviderSkill(skill: ProviderSkill, query: string): number | null {
  const fields: ReadonlyArray<readonly [string | undefined, MatchWeights, (readonly string[])?]> = [
    [skill.name, [0, 2, 4, 6, 100], ["-", "_", "/"]],
    [formatProviderSkillDisplayName(skill), [1, 3, 5, 7, 110]],
    [skill.shortDescription, [20, 22, 24, 26]],
    [skill.description, [30, 32, 34, 36]],
    [skill.scope, [40, 42, undefined, 44]],
  ]
  let best: number | null = null
  for (const [text, weights, boundaries] of fields) {
    const score = scoreQueryMatch((text ?? "").toLowerCase(), query, weights, boundaries)
    if (score !== null && (best === null || score < best)) best = score
  }
  return best
}

function normalizeSearchQuery(query: string): string {
  return query.replace(/^\$+/, "").trim().toLowerCase().replace(/\s+/g, " ")
}

function scoreQueryMatch(value: string, query: string, weights: MatchWeights, boundaries: readonly string[] = [" "]): number | null {
  if (!value || !query) return null
  const [exact, prefix, boundary, substring, fuzzy] = weights
  if (value === query) return exact
  if (value.startsWith(query)) return prefix
  const offset = value.indexOf(query)
  if (offset >= 0) {
    if (boundary !== undefined && hasBoundaryMatch(value, query, boundaries)) return boundary
    return substring + Math.min(offset / 100, 0.99)
  }
  const sequence = fuzzy === undefined ? null : fuzzySequenceScore(value, query)
  return sequence === null ? null : fuzzy! + sequence
}

function hasBoundaryMatch(
  value: string,
  query: string,
  boundaryMarkers: ReadonlyArray<string>
): boolean {
  const queryLength = query.length
  for (let index = 0; index <= value.length - queryLength; index += 1) {
    if (value.slice(index, index + queryLength) !== query) continue
    if (index === 0 || boundaryMarkers.includes(value[index - 1] ?? "")) {
      return true
    }
  }
  return false
}

function fuzzySequenceScore(value: string, query: string): number | null {
  let valueIndex = 0
  let firstMatch = -1
  let lastMatch = -1
  for (const char of query) {
    const nextIndex = value.indexOf(char, valueIndex)
    if (nextIndex < 0) return null
    if (firstMatch < 0) firstMatch = nextIndex
    lastMatch = nextIndex
    valueIndex = nextIndex + 1
  }
  return (
    firstMatch + Math.max(0, lastMatch - firstMatch - query.length + 1) / 10
  )
}
