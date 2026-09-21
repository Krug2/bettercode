import { describe, expect, it } from "vitest"
import {
  buildFavoriteModelCycleItems,
  buildModelCycleItems,
  cycleModelSelection,
} from "@/lib/model-cycle"
import type { UiProvider } from "@/lib/provider-types"

function provider(
  id: string,
  models: string[],
  configured = true
): UiProvider {
  return {
    id,
    name: id,
    logo: "",
    configured,
    models: models.map((model) => ({
      id: model,
      name: model,
      context: "",
      tier: "",
    })),
  }
}

describe("model-cycle", () => {
  it("cycles configured provider models in provider order", () => {
    const items = buildModelCycleItems([
      provider("codex", ["gpt-5.5", "gpt-5.4"]),
      provider("claude", ["opus"]),
      provider("locked", ["hidden"], false),
    ])

    expect(items.map((item) => `${item.providerId}/${item.modelId}`)).toEqual([
      "codex/gpt-5.5",
      "codex/gpt-5.4",
      "claude/opus",
    ])
    expect(
      cycleModelSelection({
        items,
        currentProviderId: "codex",
        currentModelId: "gpt-5.4",
        direction: 1,
      })
    ).toMatchObject({ providerId: "claude", modelId: "opus" })
    expect(
      cycleModelSelection({
        items,
        currentProviderId: "codex",
        currentModelId: "gpt-5.5",
        direction: -1,
      })
    ).toMatchObject({ providerId: "claude", modelId: "opus" })
  })

  it("cycles favorite models and dedupes duplicate favorite entries", () => {
    const codex = provider("codex", ["gpt-5.5"])
    const claude = provider("claude", ["opus"])
    const items = buildFavoriteModelCycleItems([
      { provider: claude, model: claude.models[0]! },
      { provider: codex, model: codex.models[0]! },
      { provider: claude, model: claude.models[0]! },
    ])

    expect(items.map((item) => `${item.providerId}/${item.modelId}`)).toEqual([
      "claude/opus",
      "codex/gpt-5.5",
    ])
    expect(
      cycleModelSelection({
        items,
        currentProviderId: "claude",
        currentModelId: "opus",
        direction: 1,
      })
    ).toMatchObject({ providerId: "codex", modelId: "gpt-5.5" })
  })
})
