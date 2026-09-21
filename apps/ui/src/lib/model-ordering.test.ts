import { describe, expect, it } from "vitest"
import {
  mapSortedModelsByProvider,
  providerModelKey,
  sortModelsForProviderInstance,
  sortProviderModelItems,
} from "@/lib/model-ordering"

describe("model ordering", () => {
  it("pins Astra above older favorites regardless of catalog order", () => {
    expect(
      sortModelsForProviderInstance(
        [{ id: "gpt-5.6-sol" }, { id: "gpt-5.5" }, { id: "gpt-6-astra" }],
        { favoriteModels: ["gpt-5.6-sol"], groupFavorites: true }
      ).map((model) => model.id)
    ).toEqual(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5"])
  })
  it("groups favorites first while preserving provider model order inside each group", () => {
    const models = [
      { id: "gpt-5.5" },
      { id: "gpt-5.4-mini" },
      { id: "crest-alpha" },
      { id: "gpt-5.3-codex" },
    ]

    expect(
      sortModelsForProviderInstance(models, {
        favoriteModels: ["gpt-5.5", "gpt-5.4-mini", "crest-alpha"],
        groupFavorites: true,
        modelOrder: ["gpt-5.4-mini", "gpt-5.5", "crest-alpha", "gpt-5.3-codex"],
      }).map((model) => model.id)
    ).toEqual(["gpt-5.4-mini", "gpt-5.5", "crest-alpha", "gpt-5.3-codex"])
  })

  it("sorts the favorites view by provider order, then provider model order", () => {
    const items = [
      { providerId: "codex_work", modelId: "crest-alpha" },
      { providerId: "claude", modelId: "claude-opus-4-7" },
      { providerId: "codex_work", modelId: "gpt-5.5" },
      { providerId: "codex_work", modelId: "gpt-5.4-mini" },
    ]
    const favoriteKeys = [
      providerModelKey("claude", "claude-opus-4-7"),
      providerModelKey("codex_work", "gpt-5.5"),
      providerModelKey("codex_work", "crest-alpha"),
      providerModelKey("codex_work", "gpt-5.4-mini"),
    ]

    expect(
      sortProviderModelItems(items, {
        favoriteModelKeys: favoriteKeys,
        providerOrder: ["codex_work", "claude"],
        modelOrderByProvider: {
          codex_work: ["gpt-5.4-mini", "gpt-5.5", "crest-alpha"],
          claude: ["claude-opus-4-7"],
        },
      }).map((item) => item.modelId)
    ).toEqual(["gpt-5.4-mini", "gpt-5.5", "crest-alpha", "claude-opus-4-7"])
  })

  it("keeps unknown provider/model ranks stable after known ranks", () => {
    const items = [
      { providerId: "unknown", modelId: "z" },
      { providerId: "codex", modelId: "gpt-5.5" },
      { providerId: "unknown", modelId: "a" },
    ]

    expect(
      sortProviderModelItems(items, {
        providerOrder: ["codex"],
        modelOrderByProvider: { codex: ["gpt-5.5"] },
      })
    ).toEqual([
      { providerId: "codex", modelId: "gpt-5.5" },
      { providerId: "unknown", modelId: "z" },
      { providerId: "unknown", modelId: "a" },
    ])
  })

  it("builds sorted provider model maps for composer model pickers", () => {
    const providers = [
      {
        id: "codex",
        models: [{ id: "gpt-5.5" }, { id: "gpt-5.4-mini" }, { id: "gpt-5.3" }],
      },
      {
        id: "claude",
        models: [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-7" }],
      },
    ]

    const sorted = mapSortedModelsByProvider(
      providers,
      (providerId, modelId) =>
        providerModelKey(providerId, modelId) ===
        providerModelKey("codex", "gpt-5.4-mini")
    )

    expect(sorted.get("codex")?.map((model) => model.id)).toEqual([
      "gpt-5.4-mini",
      "gpt-5.5",
      "gpt-5.3",
    ])
    expect(sorted.get("claude")?.map((model) => model.id)).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ])
  })
})
