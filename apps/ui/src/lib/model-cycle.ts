import type { UiProvider } from "@/lib/provider-types"

export type ModelCycleItem = {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
}

export type ModelCycleFavoriteEntry = {
  provider: UiProvider
  model: { id: string; name: string }
}

export function buildModelCycleItems(
  providers: readonly UiProvider[]
): ModelCycleItem[] {
  return providers
    .filter((provider) => provider.configured !== false)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.name,
      }))
    )
}

export function buildFavoriteModelCycleItems(
  entries: readonly ModelCycleFavoriteEntry[]
): ModelCycleItem[] {
  const seen = new Set<string>()
  const items: ModelCycleItem[] = []
  for (const entry of entries) {
    if (entry.provider.configured === false) continue
    const key = `${entry.provider.id}\u0000${entry.model.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      providerId: entry.provider.id,
      providerName: entry.provider.name,
      modelId: entry.model.id,
      modelName: entry.model.name,
    })
  }
  return items
}

export function cycleModelSelection(input: {
  items: readonly ModelCycleItem[]
  currentProviderId?: string | null
  currentModelId?: string | null
  direction: 1 | -1
}): ModelCycleItem | null {
  const items = input.items
  if (items.length === 0) return null

  const currentProviderId = input.currentProviderId ?? ""
  const currentModelId = input.currentModelId ?? ""
  const exactIndex = items.findIndex(
    (item) =>
      item.providerId === currentProviderId && item.modelId === currentModelId
  )
  const modelOnlyIndex =
    exactIndex === -1 && currentModelId
      ? items.findIndex((item) => item.modelId === currentModelId)
      : -1
  const currentIndex = exactIndex !== -1 ? exactIndex : modelOnlyIndex
  const nextIndex =
    currentIndex === -1
      ? input.direction === 1
        ? 0
        : items.length - 1
      : (currentIndex + input.direction + items.length) % items.length
  return items[nextIndex] ?? null
}

export function describeModelCycleSelection(
  item: ModelCycleItem,
  source: "model" | "favorite"
): string {
  const title = source === "favorite" ? "Favorite Model" : "Model"
  return [
    `# ${title} Selection`,
    "",
    `Selected **${item.providerName}** / \`${item.modelName || item.modelId}\`.`,
    "",
    `Provider: \`${item.providerId}\``,
    `Model: \`${item.modelId}\``,
  ].join("\n")
}
