import fs from "node:fs/promises"
import path from "node:path"
import {
  providerInstanceSnapshotSchema,
  type ProviderAgent,
  type ProviderCatalogEntry,
  type ProviderInstanceMetadata,
  type ProviderInstanceSnapshot,
  type ProviderModel,
  type ProviderSkill,
  type ProviderSlashCommand,
  type ProviderTool,
} from "@betterc0de/schema"

export interface CacheableProviderSnapshot {
  readonly instanceId: string
  readonly driver: string
  readonly displayName?: string
  readonly badgeLabel?: string
  readonly enabled: boolean
  readonly configured: boolean
  readonly installed?: boolean
  readonly version?: string | null
  readonly status?: "ready" | "warning" | "error" | "disabled"
  readonly auth?: {
    readonly status: "authenticated" | "unauthenticated" | "unknown"
    readonly type?: string
    readonly label?: string
    readonly email?: string
  }
  readonly checkedAt?: string
  readonly message?: string
  readonly availability?: "available" | "unavailable"
  readonly unavailableReason?: string
  readonly continuation?: { readonly groupKey: string }
  readonly continuationKey?: string
  readonly showInteractionModeToggle?: boolean
  readonly versionAdvisory?: ProviderInstanceSnapshot["versionAdvisory"]
  readonly updateState?: ProviderInstanceSnapshot["updateState"]
  readonly models?: ReadonlyArray<ProviderModel>
  readonly providerCatalog?: ReadonlyArray<ProviderCatalogEntry>
  readonly slashCommands?: ReadonlyArray<ProviderSlashCommand>
  readonly skills?: ReadonlyArray<ProviderSkill>
  readonly agents?: ReadonlyArray<ProviderAgent>
  readonly tools?: ReadonlyArray<ProviderTool>
  readonly metadata?: ProviderInstanceMetadata
}

export function resolveProviderStatusCachePath(input: {
  readonly cacheDir: string
  readonly instanceId: string
}): string {
  return path.join(
    input.cacheDir,
    `${encodeURIComponent(input.instanceId)}.json`
  )
}

export function isCachedProviderCorrelated(input: {
  readonly cachedProvider: ProviderInstanceSnapshot
  readonly fallbackProvider: CacheableProviderSnapshot
}): boolean {
  return (
    input.cachedProvider.instanceId === input.fallbackProvider.instanceId &&
    input.cachedProvider.driver === input.fallbackProvider.driver
  )
}

export function hydrateCachedProviderSnapshot<
  T extends CacheableProviderSnapshot,
>(input: {
  readonly cachedProvider: ProviderInstanceSnapshot
  readonly fallbackProvider: T
}): T {
  if (!isCachedProviderCorrelated(input)) return input.fallbackProvider
  if (!input.fallbackProvider.enabled) return input.fallbackProvider
  if (input.fallbackProvider.unavailableReason) return input.fallbackProvider
  if (!input.fallbackProvider.configured) return input.fallbackProvider
  if (input.cachedProvider.enabled !== input.fallbackProvider.enabled) {
    return input.fallbackProvider
  }

  // When the live scan succeeded (`status: "ready"`), the fresh model list is
  // authoritative — trust it so models the provider has legitimately dropped
  // disappear instead of being resurrected (and re-persisted) from cache
  // forever. Only when the fresh scan was non-authoritative (`status:
  // "warning"`, e.g. a transient enumeration failure) do we union the cached
  // models back in so a hiccup doesn't blank the picker.
  const freshModelsAuthoritative = input.fallbackProvider.status !== "warning"
  const freshModels = input.fallbackProvider.models ?? []
  return {
    ...input.fallbackProvider,
    models: freshModelsAuthoritative
      ? freshModels.length > 0
        ? freshModels
        : (input.cachedProvider.models ?? [])
      : mergeProviderModels(freshModels, input.cachedProvider.models ?? []),
    providerCatalog:
      input.fallbackProvider.providerCatalog &&
      input.fallbackProvider.providerCatalog.length > 0
        ? input.fallbackProvider.providerCatalog
        : (input.cachedProvider.providerCatalog ?? []),
    slashCommands:
      input.fallbackProvider.slashCommands &&
      input.fallbackProvider.slashCommands.length > 0
        ? input.fallbackProvider.slashCommands
        : (input.cachedProvider.slashCommands ?? []),
    skills:
      input.fallbackProvider.skills && input.fallbackProvider.skills.length > 0
        ? input.fallbackProvider.skills
        : (input.cachedProvider.skills ?? []),
    agents:
      input.fallbackProvider.agents && input.fallbackProvider.agents.length > 0
        ? input.fallbackProvider.agents
        : (input.cachedProvider.agents ?? []),
    tools:
      input.fallbackProvider.tools && input.fallbackProvider.tools.length > 0
        ? input.fallbackProvider.tools
        : (input.cachedProvider.tools ?? []),
    ...((input.fallbackProvider.metadata ?? input.cachedProvider.metadata)
      ? {
          metadata:
            input.fallbackProvider.metadata ?? input.cachedProvider.metadata,
        }
      : {}),
  }
}

export async function readProviderStatusCache(
  filePath: string
): Promise<ProviderInstanceSnapshot | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    const parsed = providerInstanceSnapshotSchema.safeParse(
      JSON.parse(trimmed) as unknown
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export async function writeProviderStatusCache(input: {
  readonly filePath: string
  readonly provider: CacheableProviderSnapshot
}): Promise<void> {
  const { updateState: _updateState, ...cacheableProvider } = input.provider
  await fs.mkdir(path.dirname(input.filePath), { recursive: true })
  await fs.writeFile(
    input.filePath,
    `${JSON.stringify(cacheableProvider, null, 2)}\n`,
    "utf8"
  )
}

function mergeProviderModels(
  fallbackModels: ReadonlyArray<ProviderModel>,
  cachedModels: ReadonlyArray<ProviderModel>
): ReadonlyArray<ProviderModel> {
  const normalizedFallback = normalizeProviderModels(fallbackModels)
  const fallbackSlugs = new Set(normalizedFallback.map((model) => model.slug))
  return [
    ...normalizedFallback,
    ...normalizeProviderModels(cachedModels).filter(
      (model) => !fallbackSlugs.has(model.slug)
    ),
  ]
}

function normalizeProviderModels(
  models: ReadonlyArray<ProviderModel>
): ReadonlyArray<ProviderModel> {
  return models.map((model) => ({
    ...model,
    isCustom: model.isCustom ?? false,
    capabilities: model.capabilities ?? null,
  }))
}
