import { asRecord } from "@betterc0de/schema"
import os from "node:os"
import path from "node:path"
import type { ModelCapabilities, ProviderModel } from "../contracts"
import { readGrokMetadataFile } from "./GrokMetadataFile"

/**
 * Reads the model list the Grok CLI maintains for itself.
 *
 * The CLI refreshes `~/.grok/models_cache.json` from its own `/v1/models`
 * endpoint, so it is the authoritative, self-updating answer to "which Grok
 * models can I run right now" — including the context window and the reasoning
 * ladder with its default. The app previously relied on a hardcoded fallback
 * (Grok Build 0.1 / Grok 4.3), which went stale the moment xAI shipped 4.5 and
 * 4.6 and left the picker offering models that no longer exist.
 *
 * Reading a file the CLI already wrote costs nothing and — unlike the ACP
 * probe — cannot spawn a process, so it is safe on the provider-list path.
 */

const MODEL_CACHE_FILE = "models_cache.json"

interface RawReasoningEffort {
  readonly id?: unknown
  readonly value?: unknown
  readonly label?: unknown
  readonly default?: unknown
}

interface RawModelInfo {
  readonly id?: unknown
  readonly model?: unknown
  readonly name?: unknown
  readonly context_window?: unknown
  readonly hidden?: unknown
  readonly reasoning_effort?: unknown
  readonly supports_reasoning_effort?: unknown
  readonly reasoning_efforts?: unknown
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function grokModelCachePath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".grok", MODEL_CACHE_FILE)
}

/** e.g. 500000 → "500K", 2_000_000 → "2M". */
export function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "runtime"
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function buildCapabilities(info: RawModelInfo): ModelCapabilities {
  if (info.supports_reasoning_effort !== true) return { optionDescriptors: [] }
  const raw = Array.isArray(info.reasoning_efforts)
    ? (info.reasoning_efforts as RawReasoningEffort[])
    : []
  const options: { id: string; label: string; isDefault?: boolean }[] = []
  let defaultId: string | undefined
  for (const entry of raw) {
    const record = asRecord(entry)
    const id = stringFrom(record.id) ?? stringFrom(record.value)
    if (!id) continue
    const isDefault = record.default === true
    if (isDefault) defaultId = id
    options.push({
      id,
      label: stringFrom(record.label) ?? id,
      ...(isDefault ? { isDefault: true } : {}),
    })
  }
  if (options.length === 0) return { optionDescriptors: [] }
  // The CLI names its own default; fall back to the model's stated effort.
  const currentValue = defaultId ?? stringFrom(info.reasoning_effort)
  return {
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options,
        ...(currentValue && options.some((option) => option.id === currentValue)
          ? { currentValue }
          : {}),
      },
    ],
  }
}

/**
 * Parses the cache contents. Returns an empty list for anything unexpected —
 * a malformed cache must never break the provider list, only fall through to
 * the next source.
 */
export function parseGrokModelCache(contents: string): ProviderModel[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return []
  }
  const models = asRecord(asRecord(parsed).models)
  const result: ProviderModel[] = []
  for (const [key, value] of Object.entries(models)) {
    const info = asRecord(asRecord(value).info) as RawModelInfo
    if (info.hidden === true) continue
    const slug = stringFrom(info.id) ?? stringFrom(info.model) ?? stringFrom(key)
    if (!slug) continue
    const name = stringFrom(info.name) ?? slug
    const contextWindow =
      typeof info.context_window === "number"
        ? formatContextWindow(info.context_window)
        : "runtime"
    result.push({
      slug,
      name,
      shortName: name,
      isCustom: false,
      context: contextWindow,
      tier: "Runtime",
      capabilities: buildCapabilities(info),
    })
  }
  // Newest first: the cache is keyed by id, and object order is not meaningful.
  return result.sort((a, b) => b.slug.localeCompare(a.slug, "en"))
}

/**
 * Builds models from the typed `models` field of an ACP `session/new` result.
 *
 * This is Grok's authoritative live inventory. It is easy to miss: unlike
 * Cursor, Grok does NOT advertise a `category: "model"` config option, so
 * probing `configOptions` finds nothing and the picker silently falls back to
 * a compiled-in list. The per-model `_meta` carries the same context window
 * and reasoning ladder as the on-disk cache, so both sources share the
 * capability builder below.
 */
export function buildGrokModelsFromSessionModelState(
  models:
    | {
        readonly availableModels?: ReadonlyArray<{
          readonly modelId?: string
          readonly name?: string
          readonly _meta?: Record<string, unknown>
        }>
      }
    | null
    | undefined
): ProviderModel[] {
  const available = models?.availableModels
  if (!Array.isArray(available)) return []
  const seen = new Set<string>()
  const result: ProviderModel[] = []
  for (const entry of available) {
    const slug = stringFrom(entry?.modelId)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    const meta = asRecord(entry?._meta)
    const name = stringFrom(entry?.name) ?? slug
    const contextTokens = meta.totalContextTokens
    result.push({
      slug,
      name,
      shortName: name,
      isCustom: false,
      context:
        typeof contextTokens === "number"
          ? formatContextWindow(contextTokens)
          : "runtime",
      tier: "Runtime",
      capabilities: buildCapabilities({
        supports_reasoning_effort: meta.supportsReasoningEffort,
        reasoning_effort: meta.reasoningEffort,
        reasoning_efforts: meta.reasoningEfforts,
      }),
    })
  }
  return result
}

export function readGrokModelCache(
  homeDir: string = os.homedir()
): ProviderModel[] {
  try {
    return parseGrokModelCache(
      readGrokMetadataFile(grokModelCachePath(homeDir)) ?? ""
    )
  } catch {
    // No cache yet (fresh install, or the CLI has never been run).
    return []
  }
}
