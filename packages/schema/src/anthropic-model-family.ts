/**
 * Generation-aware taxonomy for Anthropic model slugs.
 *
 * Every capability question about a Claude model used to be answered by its own
 * hand-maintained slug list or regex, spread across the backend adapters, the
 * UI, and the Electron shell. Each new release therefore had to be added in a
 * dozen places, and missing one produced a silent, hard-to-trace defect (a
 * model offered without its 1M context window, or thinking blocks vanishing
 * because a slug fell out of one regex).
 *
 * These helpers derive the answers from the family and version encoded in the
 * slug instead, so an unreleased `claude-opus-6` is classified correctly the
 * first time the app sees it — which is what lets live model discovery import
 * new models without a code change.
 */

export type AnthropicModelFamily =
  | "opus"
  | "sonnet"
  | "haiku"
  | "fable"
  | "mythos"

export interface AnthropicModelIdentity {
  readonly family: AnthropicModelFamily
  /**
   * Numeric generation, e.g. 4.8 for `claude-opus-4-8` and 5 for
   * `claude-opus-5`. `null` for a bare alias like `opus`, which always means
   * "the newest release in that family" and therefore gets newest-tier
   * capabilities.
   */
  readonly version: number | null
}

const FAMILIES: ReadonlyArray<AnthropicModelFamily> = [
  "opus",
  "sonnet",
  "haiku",
  "fable",
  "mythos",
]

/** Families that lead a generation; Sonnet trades depth for speed. */
const FLAGSHIP_FAMILIES: ReadonlySet<AnthropicModelFamily> = new Set([
  "opus",
  "fable",
  "mythos",
])

/**
 * Parses the family and generation out of an Anthropic model slug. Accepts the
 * shapes the app actually passes around: canonical (`claude-opus-4-8`), bare
 * (`opus`), dotted (`opus-4.8`), dated (`claude-haiku-4-5-20251001`) and
 * context-suffixed (`claude-sonnet-5[1m]`).
 */
export function parseAnthropicModelId(
  modelId: string | null | undefined
): AnthropicModelIdentity | null {
  if (!modelId) return null
  const normalized = modelId
    .trim()
    .toLowerCase()
    .replace(/\[(?:1m|200k)\]$/, "")
    .replace(/-(?:1m|200k)$/, "")
    .replace(/^claude-/, "")
  if (!normalized) return null

  const family = FAMILIES.find(
    (candidate) =>
      normalized === candidate || normalized.startsWith(`${candidate}-`)
  )
  if (!family) return null

  const remainder = normalized.slice(family.length).replace(/^-/, "")
  if (!remainder) return { family, version: null }

  // A trailing 8-digit release date is not part of the generation number.
  const withoutDate = remainder.replace(/-?\d{8}$/, "")
  const match = /^(\d+)(?:[.-](\d+))?/.exec(withoutDate)
  if (!match) return { family, version: null }
  const major = Number(match[1])
  if (!Number.isFinite(major)) return { family, version: null }
  const minor = match[2] ? Number(match[2]) : 0
  return {
    family,
    version: Number.isFinite(minor) ? major + minor / 10 : major,
  }
}

export function isAnthropicModelId(modelId: string | null | undefined): boolean {
  return parseAnthropicModelId(modelId) !== null
}

/** A bare alias tracks the newest release, so it gets newest-tier treatment. */
function atLeast(identity: AnthropicModelIdentity, minimum: number): boolean {
  return identity.version === null || identity.version >= minimum
}

/**
 * Opus and Sonnet gained the 1M context window in 4.6; every Claude 5-era
 * family ships with it. Haiku remains a 200K model.
 */
export function anthropicSupportsOneMillionContext(
  modelId: string | null | undefined
): boolean {
  const identity = parseAnthropicModelId(modelId)
  if (!identity) return false
  if (identity.family === "haiku") return false
  if (identity.family === "fable" || identity.family === "mythos") return true
  return atLeast(identity, 4.6)
}

export function anthropicContextLabel(
  modelId: string | null | undefined
): "1M" | "200K" {
  return anthropicSupportsOneMillionContext(modelId) ? "1M" : "200K"
}

/**
 * Whether the model takes a named effort level (low…ultrathink) instead of a
 * raw thinking-token budget. Introduced with the 4.6 generation.
 */
export function anthropicSupportsAdaptiveThinking(
  modelId: string | null | undefined
): boolean {
  const identity = parseAnthropicModelId(modelId)
  if (!identity) return false
  if (identity.family === "haiku") return false
  if (identity.family === "fable" || identity.family === "mythos") return true
  return atLeast(identity, 4.6)
}

/**
 * 4.7 flipped the API default for `thinking.display` from "summarized" to
 * "omitted". Without an explicit opt-in these models return no thinking blocks
 * at all, and the wire shape is indistinguishable from a non-thinking turn.
 * 4.6 and earlier are deliberately excluded so their output format is
 * unchanged.
 */
export function anthropicRequiresExplicitThinkingDisplay(
  modelId: string | null | undefined
): boolean {
  const identity = parseAnthropicModelId(modelId)
  if (!identity) return false
  if (identity.family === "haiku") return false
  if (identity.family === "fable" || identity.family === "mythos") return true
  return atLeast(identity, 4.7)
}

/** Reasoning depth beyond "high" — the xHigh/Max tier of the flagship models. */
export function anthropicSupportsExtendedEffort(
  modelId: string | null | undefined
): boolean {
  const identity = parseAnthropicModelId(modelId)
  if (!identity) return false
  if (!FLAGSHIP_FAMILIES.has(identity.family)) return false
  if (identity.family === "fable" || identity.family === "mythos") return true
  return atLeast(identity, 4.7)
}

/**
 * Fast mode was an Opus 4.5/4.6 affordance; the 4.7+ effort ladder replaced it.
 */
export function anthropicSupportsFastMode(
  modelId: string | null | undefined
): boolean {
  const identity = parseAnthropicModelId(modelId)
  if (!identity || identity.family !== "opus") return false
  if (identity.version === null) return false
  return identity.version >= 4.5 && identity.version < 4.7
}

export function anthropicModelTier(
  modelId: string | null | undefined
): "Flagship" | "Balanced" | "Fast" | null {
  const identity = parseAnthropicModelId(modelId)
  if (!identity) return null
  if (identity.family === "haiku") return "Fast"
  if (identity.family === "sonnet") return "Balanced"
  return "Flagship"
}

/**
 * Human label for a slug, e.g. `claude-opus-4-8` → "Claude Opus 4.8". Used for
 * models discovered at runtime, where the API may not supply a display name.
 */
export function anthropicModelDisplayName(
  modelId: string | null | undefined
): string | null {
  const identity = parseAnthropicModelId(modelId)
  if (!identity) return null
  const family =
    identity.family.charAt(0).toUpperCase() + identity.family.slice(1)
  if (identity.version === null) return `Claude ${family}`
  const version = Number.isInteger(identity.version)
    ? String(identity.version)
    : identity.version.toFixed(1)
  return `Claude ${family} ${version}`
}

/**
 * Ranks models newest-first within the conventional family order, so a merged
 * list of curated and freshly discovered models still reads sensibly.
 */
export function compareAnthropicModelIds(a: string, b: string): number {
  const left = parseAnthropicModelId(a)
  const right = parseAnthropicModelId(b)
  if (!left || !right) return 0
  const familyOrder: Record<AnthropicModelFamily, number> = {
    fable: 0,
    mythos: 1,
    opus: 2,
    sonnet: 3,
    haiku: 4,
  }
  const byFamily = familyOrder[left.family] - familyOrder[right.family]
  if (byFamily !== 0) return byFamily
  return (right.version ?? Number.MAX_SAFE_INTEGER) - (left.version ?? Number.MAX_SAFE_INTEGER)
}
