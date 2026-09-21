import { describe, expect, it, vi } from "vitest"
import { JevRankingError, rankWithJev } from "./jev-client"
import { JEV_MODEL } from "./contracts"
import { SEARCH_LIMITS } from "./limits"

const candidate = { path: "src/a.ts", startLine: 1, startColumn: 1, endLine: 1, excerpt: "const a = 1", excerptTruncated: false, sha256: "hash", lexicalScore: 1 }
function rank(fetchImpl: typeof fetch) {
  return rankWithJev({ query: "a", candidates: [candidate], apiKey: "test-key", signal: new AbortController().signal, fetchImpl })
}

describe("Jev protocol boundary", () => {
  it.each([
    {}, { model: "jev", answers: {} },
    { model: "jev", answers: { "0": { type: "noul", noul: 2 } } },
    { model: "jev", answers: { "1": { type: "noul", noul: 0.5 } } },
    { model: "jev", answers: { "0": { type: "text", noul: 0.5 } } },
  ])("rejects malformed/missing/misattributed scores: %j", async (body) => {
    await expect(rank(vi.fn(async () => Response.json(body)))).rejects.toThrow()
  })

  it("uses the pinned endpoint and never follows a credential-bearing redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ model: "jev-1.13.0", answers: { "0": { type: "noul", noul: 0.8 } } }))
    expect(await rank(fetchImpl)).toMatchObject({ model: "jev-1.13.0", scores: [0.8], usage: { requests: 1, complete: false, estimatedInputCostUsd: null } })
    expect(fetchImpl).toHaveBeenCalledWith("https://api.typesafe.ai/v1/systemone", expect.objectContaining({ method: "POST", redirect: "error", headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" } }))
  })

  it("caps response bytes even if the server omits Content-Length", async () => {
    await expect(rank(vi.fn(async () => new Response("x".repeat(70_000))))).rejects.toThrow("size limit")
  })

  it("batches Unicode snippets within context limits and joins scores by candidate ID", async () => {
    const received: number[] = []
    let active = 0
    let peak = 0
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      active++
      peak = Math.max(peak, active)
      const body = JSON.parse(String(options?.body)) as { state: { candidates: Array<{ id: number }> }; questions: Record<string, unknown> }
      expect(Buffer.byteLength(JSON.stringify(body.state))).toBeLessThanOrEqual(SEARCH_LIMITS.rankingStateBytes)
      expect(body.state.candidates.length).toBeLessThanOrEqual(SEARCH_LIMITS.rankingBatchCandidates)
      const ids = body.state.candidates.map((c) => c.id)
      received.push(...ids)
      expect(Object.keys(body.questions).map(Number)).toEqual(ids)
      await new Promise((resolve) => setTimeout(resolve, ids[0] === 0 ? 10 : 1))
      active--
      return Response.json({ model: JEV_MODEL, answers: Object.fromEntries(ids.map((id) => [id, { type: "noul", noul: id / 100 }])), usage: { input_tokens: 1000, output_tokens: 20 } })
    })
    const result = await rankWithJev({ query: "dispatch", candidates: Array.from({ length: 64 }, (_, id) => ({ ...candidate, path: `src/${id}.ts`, excerpt: "界".repeat(2400) })), apiKey: "test-key", signal: new AbortController().signal, fetchImpl })
    expect(received.sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, id) => id))
    expect(result.scores).toEqual(Array.from({ length: 64 }, (_, id) => id / 100))
    expect(peak).toBe(2)
    expect(result.usage).toMatchObject({ requests: fetchImpl.mock.calls.length, inputTokens: fetchImpl.mock.calls.length * 1000, outputTokens: fetchImpl.mock.calls.length * 20, complete: true })
    expect(result.usage.estimatedInputCostUsd).toBeCloseTo(result.usage.inputTokens / 1_000_000 * 0.042, 12)
  })

  it("does not misattribute other-batch IDs even when the score count matches", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body))
      return Response.json({ model: JEV_MODEL, answers: Object.fromEntries(body.state.candidates.map((_: unknown, i: number) => [i, { type: "noul", noul: 0.5 }])) })
    })
    await expect(rankWithJev({ query: "dispatch", candidates: Array.from({ length: 32 }, () => candidate), apiKey: "test-key", signal: new AbortController().signal, fetchImpl })).rejects.toBeInstanceOf(JevRankingError)
  })

  it("retains known usage on partial failure and stops scheduling paid batches", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body))
      if (body.state.candidates[0].id !== 0) return new Response("private-key", { status: 429 })
      await new Promise((resolve) => setTimeout(resolve, 10))
      return Response.json({ model: JEV_MODEL, answers: Object.fromEntries(body.state.candidates.map(({ id }: { id: number }) => [id, { type: "noul", noul: 0.5 }])), usage: { input_tokens: 321, output_tokens: 0 } })
    })
    const promise = rankWithJev({ query: "dispatch", candidates: Array.from({ length: 64 }, () => candidate), apiKey: "private-key", signal: new AbortController().signal, fetchImpl })
    await expect(promise).rejects.toMatchObject({ usage: { requests: 2, inputTokens: 321, complete: false, estimatedInputCostUsd: null } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("does not turn malformed token usage into a zero-cost success", async () => {
    const result = await rank(vi.fn(async () => Response.json({ model: JEV_MODEL, answers: { "0": { type: "noul", noul: 0.8 } }, usage: { input_tokens: -1, output_tokens: 0 } })))
    expect(result.scores).toEqual([0.8])
    expect(result.usage).toMatchObject({ complete: false, estimatedInputCostUsd: null })
  })
})
