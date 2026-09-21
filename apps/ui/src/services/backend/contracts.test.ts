import { afterEach, describe, expect, it, vi } from "vitest"
import "@betterc0de/schema/http-contracts"
import { invokeContract } from "./contracts"
import { invoke } from "./runtime"

vi.mock("./runtime", () => ({ invoke: vi.fn() }))
afterEach(() => vi.clearAllMocks())

describe("renderer HTTP contracts", () => {
  it("validates actual transport responses before exposing them", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: "approved" })
    await expect(
      invokeContract("chatApproval", {
        body: {
          threadId: "t",
          providerKind: "codex",
          requestId: "r",
          decision: "approve",
        },
      })
    ).rejects.toThrow("Invalid backend response")
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it("does not send legacy GET args as a request body", async () => {
    vi.mocked(invoke).mockResolvedValue([])
    await expect(
      invokeContract("listActivities", { id: "a/b", args: { threadId: "a/b" } })
    ).resolves.toEqual([])
    expect(invoke).toHaveBeenCalledWith(
      "/threads/a%2Fb/activities",
      expect.objectContaining({ method: "GET", body: undefined })
    )
  })
})
