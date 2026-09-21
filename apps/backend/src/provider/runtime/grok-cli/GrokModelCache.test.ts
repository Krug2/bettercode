import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildGrokModelsFromSessionModelState,
  formatContextWindow,
  grokModelCachePath,
  parseGrokModelCache,
  readGrokModelCache,
} from "./GrokModelCache"

const cleanup: string[] = []

function tempHome(cacheContents?: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-grok-"))
  cleanup.push(home)
  if (cacheContents !== undefined) {
    fs.mkdirSync(path.join(home, ".grok"), { recursive: true })
    fs.writeFileSync(grokModelCachePath(home), cacheContents)
  }
  return home
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Shape taken from a real ~/.grok/models_cache.json.
const REAL_CACHE = JSON.stringify({
  fetched_at: "2026-08-22T01:18:10.046036600Z",
  origin: "https://cli-chat-proxy.grok.com/v1/models",
  models: {
    "grok-4.5": {
      info: {
        id: "grok-4.5",
        name: "Grok 4.5",
        context_window: 500000,
        hidden: false,
        reasoning_effort: "high",
        supports_reasoning_effort: true,
        reasoning_efforts: [
          { id: "high", label: "High Effort", default: true },
          { id: "medium", label: "Medium Effort", default: false },
          { id: "low", label: "Low Effort", default: false },
        ],
      },
    },
    "grok-4.6": {
      info: {
        id: "grok-4.6",
        name: "Grok 4.6",
        context_window: 500000,
        hidden: false,
        reasoning_effort: "high",
        supports_reasoning_effort: true,
        reasoning_efforts: [
          { id: "xhigh", label: "Extra High Effort", default: false },
          { id: "high", label: "High Effort", default: true },
          { id: "medium", label: "Medium Effort", default: false },
          { id: "low", label: "Low Effort", default: false },
        ],
      },
    },
  },
})

describe("parseGrokModelCache", () => {
  it("reads the models the CLI currently offers, newest first", () => {
    const models = parseGrokModelCache(REAL_CACHE)
    expect(models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-4.5"])
    expect(models[0]).toMatchObject({
      slug: "grok-4.6",
      name: "Grok 4.6",
      context: "500K",
      isCustom: false,
    })
  })

  it("carries the reasoning ladder and the CLI's own default", () => {
    const [latest] = parseGrokModelCache(REAL_CACHE)
    const descriptor = latest?.capabilities?.optionDescriptors?.find(
      (entry) => entry.id === "reasoningEffort"
    )
    expect(descriptor?.type).toBe("select")
    if (descriptor?.type !== "select") throw new Error("expected a select")
    expect(descriptor.options.map((option) => option.id)).toEqual([
      "xhigh",
      "high",
      "medium",
      "low",
    ])
    expect(descriptor.currentValue).toBe("high")
    expect(
      descriptor.options.find((option) => option.isDefault)?.id
    ).toBe("high")
  })

  it("skips models the CLI marks hidden", () => {
    const models = parseGrokModelCache(
      JSON.stringify({
        models: {
          visible: { info: { id: "grok-4.6", name: "Grok 4.6" } },
          internal: { info: { id: "grok-secret", hidden: true } },
        },
      })
    )
    expect(models.map((model) => model.slug)).toEqual(["grok-4.6"])
  })

  it("omits reasoning options when the model does not support effort", () => {
    const [model] = parseGrokModelCache(
      JSON.stringify({
        models: { a: { info: { id: "grok-x", supports_reasoning_effort: false } } },
      })
    )
    expect(model?.capabilities?.optionDescriptors).toEqual([])
  })

  // A corrupt cache must never take the provider list down with it.
  it("returns nothing for malformed or unexpected contents", () => {
    expect(parseGrokModelCache("not json")).toEqual([])
    expect(parseGrokModelCache("null")).toEqual([])
    expect(parseGrokModelCache(JSON.stringify({ models: "nope" }))).toEqual([])
    expect(parseGrokModelCache(JSON.stringify({ models: {} }))).toEqual([])
  })
})

describe("readGrokModelCache", () => {
  it("ignores an oversized cache instead of parsing it on the provider-list path", () => {
    const home = tempHome(REAL_CACHE + " ".repeat(1024 * 1024))
    expect(readGrokModelCache(home)).toEqual([])
  })

  it("reads the file from the Grok home directory", () => {
    const home = tempHome(REAL_CACHE)
    expect(readGrokModelCache(home).map((model) => model.slug)).toEqual([
      "grok-4.6",
      "grok-4.5",
    ])
  })

  it("returns nothing when the CLI has never written a cache", () => {
    expect(readGrokModelCache(tempHome())).toEqual([])
  })
})

// Shape captured from a live `session/new` against grok.exe. Grok advertises
// models HERE, not via a `category: "model"` config option — probing config
// options finds nothing, which is why the picker used to show a stale list.
describe("buildGrokModelsFromSessionModelState", () => {
  const LIVE = {
    currentModelId: "grok-4.6",
    availableModels: [
      {
        modelId: "grok-4.6",
        name: "Grok 4.6",
        description: "SpaceXAI's latest frontier model",
        _meta: {
          totalContextTokens: 500000,
          supportsReasoningEffort: true,
          reasoningEffort: "xhigh",
          reasoningEfforts: [
            { id: "xhigh", label: "Extra High Effort", default: false },
            { id: "high", label: "High Effort", default: true },
            { id: "medium", label: "Medium Effort", default: false },
            { id: "low", label: "Low Effort", default: false },
          ],
        },
      },
    ],
  }

  it("reads the models Grok advertises on session/new", () => {
    const models = buildGrokModelsFromSessionModelState(LIVE)
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      slug: "grok-4.6",
      name: "Grok 4.6",
      context: "500K",
      isCustom: false,
    })
  })

  it("carries the reasoning ladder and the agent's default", () => {
    const descriptor = buildGrokModelsFromSessionModelState(
      LIVE
    )[0]?.capabilities?.optionDescriptors?.find(
      (entry) => entry.id === "reasoningEffort"
    )
    expect(descriptor?.type).toBe("select")
    if (descriptor?.type !== "select") throw new Error("expected a select")
    expect(descriptor.options.map((option) => option.id)).toEqual([
      "xhigh",
      "high",
      "medium",
      "low",
    ])
    // The ladder's own `default: true` wins over the model's stated effort.
    expect(descriptor.currentValue).toBe("high")
  })

  it("dedupes and skips entries without a model id", () => {
    const models = buildGrokModelsFromSessionModelState({
      availableModels: [
        { modelId: "grok-4.6", name: "Grok 4.6" },
        { modelId: "grok-4.6", name: "duplicate" },
        { name: "no id" },
      ],
    })
    expect(models.map((model) => model.slug)).toEqual(["grok-4.6"])
  })

  it("returns nothing for an agent that advertises no models", () => {
    expect(buildGrokModelsFromSessionModelState(undefined)).toEqual([])
    expect(buildGrokModelsFromSessionModelState({})).toEqual([])
    expect(
      buildGrokModelsFromSessionModelState({ availableModels: [] })
    ).toEqual([])
  })
})

describe("formatContextWindow", () => {
  it("formats token counts the way the picker shows them", () => {
    expect(formatContextWindow(500_000)).toBe("500K")
    expect(formatContextWindow(2_000_000)).toBe("2M")
    expect(formatContextWindow(1_500_000)).toBe("1.5M")
    expect(formatContextWindow(256_000)).toBe("256K")
    expect(formatContextWindow(0)).toBe("runtime")
  })
})
