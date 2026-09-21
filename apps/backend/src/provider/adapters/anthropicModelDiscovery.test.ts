import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetAnthropicModelDiscoveryForTests,
  fetchAnthropicModels,
  getDiscoveredAnthropicModels,
  scheduleAnthropicModelDiscovery,
  selectNewAnthropicModels,
} from "./anthropicModelDiscovery"

const CURATED = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
]

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}

beforeEach(() => {
  __resetAnthropicModelDiscoveryForTests()
})

describe("selectNewAnthropicModels", () => {
  it("imports releases newer than anything curated", () => {
    const kept = selectNewAnthropicModels(CURATED, [
      { id: "claude-opus-6", displayName: "Claude Opus 6" },
      { id: "claude-sonnet-6", displayName: null },
    ])
    expect(kept.map((model) => model.id)).toEqual([
      "claude-opus-6",
      "claude-sonnet-6",
    ])
  })

  it("keeps the endpoint's back catalogue out of the picker", () => {
    const kept = selectNewAnthropicModels(CURATED, [
      { id: "claude-3-opus-20240229", displayName: "Claude 3 Opus" },
      { id: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet" },
      { id: "claude-opus-4-7", displayName: "Claude Opus 4.7" },
      { id: "claude-2.1", displayName: "Claude 2.1" },
    ])
    expect(kept).toEqual([])
  })

  it("ignores duplicates and models already curated", () => {
    const kept = selectNewAnthropicModels(CURATED, [
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
      { id: "CLAUDE-OPUS-6", displayName: null },
      { id: "claude-opus-6", displayName: null },
    ])
    expect(kept.map((model) => model.id)).toEqual(["CLAUDE-OPUS-6"])
  })

  it("adopts an entirely new family", () => {
    const kept = selectNewAnthropicModels(
      ["claude-opus-5"],
      [{ id: "claude-mythos-5", displayName: "Claude Mythos 5" }]
    )
    expect(kept.map((model) => model.id)).toEqual(["claude-mythos-5"])
  })
})

describe("fetchAnthropicModels", () => {
  it("follows pagination and normalizes entries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "claude-opus-6", display_name: "Claude Opus 6" },
            { id: "  ", display_name: "junk" },
            { id: "claude-sonnet-6" },
          ],
          has_more: true,
          last_id: "claude-sonnet-6",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "claude-haiku-6" }], has_more: false })
      )

    const models = await fetchAnthropicModels("sk-test-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(models).toEqual([
      { id: "claude-opus-6", displayName: "Claude Opus 6" },
      { id: "claude-sonnet-6", displayName: null },
      { id: "claude-haiku-6", displayName: null },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-test-key"
    )
  })

  it("rejects a non-OK response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(
      fetchAnthropicModels("sk-bad", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/401/)
  })
})

describe("scheduleAnthropicModelDiscovery", () => {
  it("isolates credentials with the same suffix during fetch and after caching", async () => {
    const firstKey = "sk-account-one-same-tail"
    const secondKey = "sk-account-two-same-tail"
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const key = (init?.headers as Record<string, string>)["x-api-key"]
      return jsonResponse({
        data: [{ id: key === firstKey ? "claude-opus-6" : "claude-sonnet-6" }],
        has_more: false,
      })
    })
    const options = { fetchImpl: fetchImpl as typeof fetch }

    scheduleAnthropicModelDiscovery(firstKey, options)
    scheduleAnthropicModelDiscovery(secondKey, options)
    await vi.waitFor(() => {
      expect(getDiscoveredAnthropicModels(firstKey)).toEqual([
        { id: "claude-opus-6", displayName: null },
      ])
      expect(getDiscoveredAnthropicModels(secondKey)).toEqual([
        { id: "claude-sonnet-6", displayName: null },
      ])
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    scheduleAnthropicModelDiscovery(firstKey, options)
    scheduleAnthropicModelDiscovery(secondKey, options)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("caches per key and does not refetch inside the TTL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ id: "claude-opus-6" }], has_more: false })
      )
    const options = { fetchImpl: fetchImpl as unknown as typeof fetch }

    scheduleAnthropicModelDiscovery("sk-key-one", options)
    // Concurrent callers must coalesce onto the in-flight request.
    scheduleAnthropicModelDiscovery("sk-key-one", options)
    await vi.waitFor(() =>
      expect(getDiscoveredAnthropicModels("sk-key-one")).toHaveLength(1)
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    scheduleAnthropicModelDiscovery("sk-key-one", options)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // A different account must not read the first key's cache.
    expect(getDiscoveredAnthropicModels("sk-key-two")).toEqual([])
  })

  it("survives a failing endpoint and reports the error", async () => {
    const onError = vi.fn()
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"))
    scheduleAnthropicModelDiscovery("sk-offline", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onError,
    })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(getDiscoveredAnthropicModels("sk-offline")).toEqual([])
  })

  it("does nothing without a key", () => {
    const fetchImpl = vi.fn()
    scheduleAnthropicModelDiscovery(null, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    scheduleAnthropicModelDiscovery("   ", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
