import path from "node:path"
import type { CodeCandidate } from "./contracts"
import { SEARCH_LIMITS } from "./limits"

const STOP_WORDS = new Set("the a an is are where how what which does do in to of for and or this that with find code function implementation die der das ein eine ist wie wo und oder für mit von den dem im".split(" "))

export function searchTerms(query: string, keywords?: readonly string[]): string[] {
  return [...new Set((keywords ?? query.match(/[\p{L}\p{N}_.$-]{2,80}/gu) ?? [])
    .map((term) => term.toLowerCase()).filter((term) => keywords || !STOP_WORDS.has(term)))].slice(0, 16)
}

export function pathRelevance(file: string, terms: readonly string[]): number {
  const name = file.toLowerCase()
  return terms.reduce((score, term) => score + (name.includes(term) ? 1 : 0), 0)
}

interface CandidateFeatures {
  readonly candidate: CodeCandidate
  readonly pathMatches: readonly boolean[]
  readonly occurrences: readonly number[]
}

/** Lexical heuristics, not a parser: imports alone must not dominate definitions. */
export function analyzeCandidate(file: string, content: string, sha256: string, terms: readonly string[]): CandidateFeatures | null {
  const lines = content.split(/\r?\n/)
  const pathMatches = terms.map((term) => file.toLowerCase().includes(term))
  const occurrences = terms.map(() => 0)
  const lineScores: number[] = []
  const firstColumns: number[] = []
  let importBlock = false
  for (const line of lines) {
    const text = line.toLowerCase()
    const startsImport = /^\s*(?:import\b|from\s+\S+\s+import\b|use\s+\S+|export\s*(?:type\s*)?\{)/.test(line)
    const isImport = startsImport || importBlock
    if (startsImport && /[{(]/.test(line) && !/[})]/.test(line)) importBlock = true
    if (importBlock && /[})]/.test(line)) importBlock = false
    const isDefinition = /\b(?:function|class|interface|type|enum|def|fn|struct|trait)\s+[\w$]+|^\s*(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=|^\s*(?:(?:public|private|protected|static|async|override)\s+)*[\w$]+\s*\([^;]*\)\s*(?::[^=]+)?\s*\{/.test(line)
    const weight = isImport ? 0.1 : isDefinition ? 2.5 : /^\s*(?:\/\/|\/\*|\*|#)/.test(line) ? 0.6 : 1
    let score = 0
    let column = Infinity
    for (let t = 0; t < terms.length; t++) {
      const at = text.indexOf(terms[t]!)
      if (at < 0) continue
      occurrences[t]! += weight
      score += weight
      column = Math.min(column, at)
    }
    lineScores.push(score)
    firstColumns.push(Number.isFinite(column) ? column : 0)
  }
  if (!pathMatches.some(Boolean) && !occurrences.some((count) => count > 0)) return null
  let bestLine = Math.max(0, lines.findIndex((line) => /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|def|fn)\b/.test(line)))
  let bestScore = 0
  for (let i = 0; i < lines.length; i++) {
    if (!lineScores[i]) continue
    let score = lineScores[i]! * 2
    for (let j = Math.max(0, i - 3); j < Math.min(lines.length, i + 9); j++) {
      if (i !== j) score += lineScores[j]! / (2 + Math.abs(i - j))
    }
    if (score > bestScore) { bestScore = score; bestLine = i }
  }
  let start = Math.max(0, bestLine - 2)
  while (start < bestLine && lines.slice(start, bestLine).join("\n").length > 400) start++
  const bestColumn = firstColumns[bestLine] ?? 0
  const startColumn = bestColumn >= 1600 ? Math.max(0, bestColumn - 400) : 0
  if (startColumn > 0) start = bestLine
  const selected = lines.slice(start, bestLine + 19).join("\n")
  const excerpt = selected.slice(startColumn, startColumn + SEARCH_LIMITS.excerptChars)
  return {
    candidate: {
      path: file, startLine: start + 1, startColumn: startColumn + 1,
      endLine: start + excerpt.split("\n").length, excerpt,
      excerptTruncated: startColumn > 0 || selected.length > excerpt.length,
      sha256, lexicalScore: 0,
    },
    pathMatches, occurrences,
  }
}

/** Deduplicate hashes before frequency weighting and shortlist selection. */
export function selectCandidates(features: readonly CandidateFeatures[], terms: readonly string[]): {
  candidates: CodeCandidate[]; uniqueMatchCount: number; duplicateFiles: number
} {
  const unique = new Map<string, CandidateFeatures>()
  for (const next of features) {
    const previous = unique.get(next.candidate.sha256)
    const rank = (entry: CandidateFeatures) => pathRelevance(entry.candidate.path, terms)
    if (!previous || rank(next) > rank(previous) || (rank(next) === rank(previous) && (
      next.candidate.path.length < previous.candidate.path.length ||
      (next.candidate.path.length === previous.candidate.path.length && next.candidate.path < previous.candidate.path)
    ))) unique.set(next.candidate.sha256, next)
  }
  const entries = [...unique.values()]
  const weights = terms.map((_, t) => {
    const frequency = entries.filter((entry) => entry.pathMatches[t] || entry.occurrences[t]! > 0).length
    return 1 + Math.log(1 + entries.length / (1 + frequency))
  })
  const pool = entries.map(({ candidate, pathMatches, occurrences }) => ({
    ...candidate,
    lexicalScore: weights.reduce((score, weight, t) => score + weight * (
      (pathMatches[t] ? 5 : 0) + Math.log1p(occurrences[t]!)
    ), 0),
  })).sort((a, b) => b.lexicalScore - a.lexicalScore || a.path.localeCompare(b.path))
  // Soft diversity penalty, with no hard per-directory exclusion.
  const candidates: CodeCandidate[] = []
  const selectedByDirectory = new Map<string, number>()
  while (pool.length && candidates.length < SEARCH_LIMITS.candidates) {
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i]!
      const count = selectedByDirectory.get(path.posix.dirname(candidate.path)) ?? 0
      const score = candidate.lexicalScore / (1 + count * 0.2)
      if (score > bestScore) { best = i; bestScore = score }
    }
    const chosen = pool.splice(best, 1)[0]!
    candidates.push(chosen)
    const directory = path.posix.dirname(chosen.path)
    selectedByDirectory.set(directory, (selectedByDirectory.get(directory) ?? 0) + 1)
  }
  return { candidates, uniqueMatchCount: entries.length, duplicateFiles: features.length - entries.length }
}
