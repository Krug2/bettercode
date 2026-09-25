import { describe, expect, it, vi } from "vitest"
import { decisionSettingsSchema, emptyDecisionSnapshot, type DecisionSettings, type DecisionSnapshot } from "@betterc0de/schema"
import { DecisionService } from "./service"
import type { selectCandidate } from "./client"

function fixture(config: Partial<DecisionSettings> = {}) {
  const settings = { decision_layer: decisionSettingsSchema.parse({ mode: "jev", ...config }), jev_api_key: "test" }
  const select = vi.fn<typeof selectCandidate>().mockResolvedValue({ choice: "worker", confidence: 0.9, model: "test", inputTokens: 12, outputTokens: 3 })
  const published: DecisionSnapshot[] = []
  const service = new DecisionService({ settings: () => settings, load: () => null, publish: value => published.push(value), select })
  const input = { threadId: "chat", kind: "route" as const, task: "private task text", candidates: [{ id: "worker", label: "Worker", description: "private description" }], valid: () => true }
  return { service, select, input, settings, published }
}

describe("decision execution", () => {
  it("publishes start and completion without retaining prompts", async () => {
    const { service, input, published } = fixture()
    expect(await service.choose(input)).toBe("worker")
    expect(published.map(value => value.records[0]?.status)).toEqual(["deciding", "selected"])
    expect(published[1]).toMatchObject({ calls: 1, selected: 1, inputTokens: 12, outputTokens: 3 })
    expect(JSON.stringify(published)).not.toContain("private")
  })
  it("abstains on low confidence and accounts for its tokens", async () => {
    const { service, input, select } = fixture()
    select.mockResolvedValue({ choice: "worker", confidence: 0.1, model: "test", inputTokens: 7, outputTokens: 2 })
    expect(await service.choose(input)).toBeNull()
    expect(service.snapshot("chat")).toMatchObject({ fallbacks: 1, inputTokens: 7 })
  })
  it("rechecks authorization after the selector returns", async () => {
    const { service, input } = fixture()
    expect(await service.choose({ ...input, valid: () => false })).toBeNull()
    expect(service.snapshot("chat").records[0]?.reason).toBe("state changed")
  })
  it("uses a per-turn call budget and makes no calls when disabled", async () => {
    const { service, input, select, settings } = fixture({ maxCallsPerTurn: 1 })
    await service.choose(input)
    expect(await service.choose(input)).toBeNull()
    expect(select).toHaveBeenCalledTimes(1)
    service.beginTurn("chat")
    await service.choose(input)
    expect(select).toHaveBeenCalledTimes(2)
    settings.decision_layer.mode = "off"
    await service.choose(input)
    expect(select).toHaveBeenCalledTimes(2)
  })
  it("times out even if a model transport ignores abort", async () => {
    vi.useFakeTimers()
    try {
      const { service, input, select } = fixture({ timeoutMs: 250 })
      select.mockImplementation(() => new Promise(() => undefined))
      const pending = service.choose(input)
      await vi.advanceTimersByTimeAsync(251)
      expect(await pending).toBeNull()
      expect(service.snapshot("chat")).toMatchObject({ unreported: 1, fallbacks: 1 })
    } finally { vi.useRealTimers() }
  })
  it("cancels a pending decision on a new turn", async () => {
    const { service, input, select } = fixture()
    select.mockImplementation(() => new Promise(() => undefined))
    const pending = service.choose(input)
    service.beginTurn("chat")
    expect(await pending).toBeNull()
    expect(service.snapshot("chat").records[0]?.status).toBe("cancelled")
  })
  it("bounds the visible history while retaining totals", async () => {
    const { service, input } = fixture({ maxCallsPerTurn: 64 })
    for (let index = 0; index < 70; index++) await service.choose(input)
    expect(service.snapshot("chat")).toMatchObject({ calls: 64, selected: 64, fallbacks: 6 })
    expect(service.snapshot("chat").records).toHaveLength(64)
  })
  it("recovers interrupted records after restart", async () => {
    const { service: original, input, select, published } = fixture()
    select.mockImplementation(() => new Promise(() => undefined))
    const pending = original.choose(input)
    const saved = published[0]!
    const recovered = new DecisionService({ settings: () => ({ decision_layer: decisionSettingsSchema.parse({}) }), load: () => saved, publish: () => undefined })
    expect(recovered.snapshot("chat").records[0]?.reason).toBe("interrupted by restart")
    expect(recovered.snapshot("another")).toEqual(emptyDecisionSnapshot("another"))
    original.close()
    await pending
  })
})
