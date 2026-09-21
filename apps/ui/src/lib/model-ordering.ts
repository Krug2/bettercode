export interface ModelIdItem {
  readonly id: string
}

export interface ProviderModelItem {
  readonly providerId: string
  readonly modelId: string
}

export function providerModelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

export function sortModelsForProviderInstance<T extends ModelIdItem>(
  models: ReadonlyArray<T>,
  options?: {
    readonly modelOrder?: ReadonlyArray<string>
    readonly favoriteModels?: ReadonlySet<string> | ReadonlyArray<string>
    readonly groupFavorites?: boolean
  },
): T[] {
  const favorites = toSet(options?.favoriteModels)
  const requested = rankByValue(options?.modelOrder ?? [])
  const original = rankByValue(models.map(model => model.id))
  return rankItems(models, model => [
    model.id === "gpt-6-astra" ? 0 : 1,
    options?.groupFavorites === true && favorites.has(model.id) ? 0 : 1,
    requested.get(model.id) ?? Infinity,
    original.get(model.id) ?? Infinity,
  ])
}

export function sortProviderModelItems<T extends ProviderModelItem>(
  items: ReadonlyArray<T>,
  options?: {
    readonly favoriteModelKeys?: ReadonlySet<string> | ReadonlyArray<string>
    readonly groupFavorites?: boolean
    readonly providerOrder?: ReadonlyArray<string>
    readonly modelOrderByProvider?: ReadonlyMap<string, ReadonlyArray<string>> | Readonly<Record<string, ReadonlyArray<string>>>
  },
): T[] {
  const favorites = toSet(options?.favoriteModelKeys)
  const providers = rankByValue(options?.providerOrder ?? [])
  const original = rankByValue(items.map(item => providerModelKey(item.providerId, item.modelId)))
  return rankItems(items, item => {
    const key = providerModelKey(item.providerId, item.modelId)
    return [
      options?.groupFavorites === true && favorites.has(key) ? 0 : 1,
      providers.get(item.providerId) ?? Infinity,
      providerModelRank(options?.modelOrderByProvider, item.providerId, item.modelId) ?? Infinity,
      original.get(key) ?? Infinity,
    ]
  })
}

export function mapSortedModelsByProvider<TModel extends ModelIdItem>(
  providers: ReadonlyArray<{ readonly id: string; readonly models: ReadonlyArray<TModel> }>,
  isFavorite: (providerId: string, modelId: string) => boolean,
): ReadonlyMap<string, ReadonlyArray<TModel>> {
  return new Map(providers.map(({ id, models }) => {
    const favoriteModels = new Set<string>()
    for (const model of models) {
      if (isFavorite(id, model.id)) favoriteModels.add(model.id)
    }
    return [id, sortModelsForProviderInstance(models, { favoriteModels, groupFavorites: true })]
  }))
}

function toSet(
  values: ReadonlySet<string> | ReadonlyArray<string> | undefined,
): ReadonlySet<string> {
  return values instanceof Set ? values : new Set(values ?? [])
}

function rankByValue(values: ReadonlyArray<string>): ReadonlyMap<string, number> {
  return new Map(values.map((value, index) => [value, index] as const))
}

function providerModelRank(
  modelOrderByProvider:
    | ReadonlyMap<string, ReadonlyArray<string>>
    | Readonly<Record<string, ReadonlyArray<string>>>
    | undefined,
  providerId: string,
  modelId: string,
): number | undefined {
  if (!modelOrderByProvider) return undefined
  const models = isReadonlyStringArrayMap(modelOrderByProvider)
    ? modelOrderByProvider.get(providerId)
    : modelOrderByProvider[providerId]
  return models?.indexOf(modelId)
}

function isReadonlyStringArrayMap(
  value:
    | ReadonlyMap<string, ReadonlyArray<string>>
    | Readonly<Record<string, ReadonlyArray<string>>>,
): value is ReadonlyMap<string, ReadonlyArray<string>> {
  return typeof (value as ReadonlyMap<string, ReadonlyArray<string>>).get === "function"
}



function rankItems<T>(items: ReadonlyArray<T>, rank: (item: T) => readonly number[]): T[] {
  // Calculate ranks once per item, rather than rebuilding lookup state inside the comparator.
  const decorated = items.map((item, index) => ({ item, index, rank: rank(item) }))
  decorated.sort((a, b) => {
    for (let field = 0; field < a.rank.length; field++) {
      const difference = a.rank[field]! - b.rank[field]!
      if (difference) return difference
    }
    return a.index - b.index
  })
  return decorated.map(entry => entry.item)
}
