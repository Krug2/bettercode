import { describe, expect, it, vi } from "vitest"
import { decisionSettingsSchema } from "@betterc0de/schema"
import { selectCandidate } from "./client"

const candidates = [{ id: "worker_a", label: "Worker", description: "Quick inspection" }]
const settings = decisionSettingsSchema.parse({ mode: "jev" })
const response = () => ({ model: "jev-test", answers: { selection: {
  type: "choice", choice: "worker_a", confidence: 0.9, probabilities: { worker_a: 0.95, abstain: 0.05 },
} }, usage: { input_tokens: 20, output_tokens: 4 } })
const run = (fetchImpl: typeof fetch) => selectCandidate({ settings, candidates, task: "Inspect a file", apiKey: "test-key", signal: new AbortController().signal, fetchImpl })

describe("decision clients", () => {
  it("uses direct typed choice requests and retains reported usage", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()))
    expect(await run(fetchImpl)).toMatchObject({ choice: "worker_a", confidence: 0.9, inputTokens: 20, outputTokens: 4 })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(init?.redirect).toBe("error")
    expect(JSON.parse(String(init?.body)).questions.selection.criteria.abstain).toBeTruthy()
  })
  it("rejects unknown choices and keeps usage on invalid answers", async () => {
    const raw = response()
    raw.answers.selection.choice = "execute_shell"
    await expect(run(vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw))))
      .rejects.toMatchObject({ usage: { inputTokens: 20, outputTokens: 4 } })
  })
  it("does not leak transport errors or credentials", async () => {
    await expect(run(vi.fn<typeof fetch>().mockRejectedValue(new Error("test-key"))))
      .rejects.toThrow("selector unavailable")
  })
  it("supports local JSON decisions without inventing confidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"choice":"worker_a"}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }))
    const result = await selectCandidate({ settings: decisionSettingsSchema.parse({ mode: "local", localModel: "local-test" }), candidates, task: "inspect", signal: new AbortController().signal, fetchImpl })
    expect(result).toMatchObject({ choice: "worker_a", confidence: null, inputTokens: 5 })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/v1/chat/completions")
  })
  it("restricts local endpoints to loopback without embedded credentials", () => {
    for (const localUrl of ["https://example.com/v1", "http://user:secret@localhost/v1", "http://localhost/v1?token=x"])
      expect(decisionSettingsSchema.safeParse({ localUrl }).success).toBe(false)
  })
})
