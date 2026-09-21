import { defaultSettings } from "@betterc0de/schema"
import {
  httpContracts,
  requestHttpContract,
} from "@betterc0de/schema/http-contracts"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { handleHttpContract } from "./contracts"

describe("shared HTTP contracts", () => {
  it("rejects invalid requests before dispatch and never retries an invalid response", async () => {
    const transport = vi.fn().mockResolvedValue({ status: "streaming" })
    await expect(
      requestHttpContract("chatSend", transport, { body: { message: "hello" } })
    ).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
    await expect(
      requestHttpContract("chatSend", transport, {
        body: {
          threadId: "t",
          message: "hello",
          modelId: "model",
          providerKind: "codex",
        },
      })
    ).rejects.toThrow("Invalid backend response")
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it("accepts uncertain-dispatch recovery responses without reissuing the turn", async () => {
    const response = { status: "streaming", turnId: "turn-1", replayed: true }
    const transport = vi.fn().mockResolvedValue(response)
    await expect(
      requestHttpContract("chatSend", transport, {
        body: { threadId: "t", message: "hello", modelId: "model" },
      })
    ).resolves.toEqual(response)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it("requires a reason for failed approvals and rejects unknown statuses", () => {
    expect(
      httpContracts.chatApproval.response.safeParse({ status: "failed" })
        .success
    ).toBe(false)
    expect(
      httpContracts.chatApproval.response.safeParse({ status: "approved" })
        .success
    ).toBe(false)
    expect(
      httpContracts.chatApproval.response.parse({
        status: "failed",
        error: "Request is no longer pending",
      }).status
    ).toBe("failed")
  })

  it("keeps secret metadata and rejects plaintext secrets, including nested provider fields", () => {
    const settings = {
      ...defaultSettings(),
      deepgram_api_key: { configured: true, storage: "encrypted" },
    }
    expect(httpContracts.getSettings.response.parse(settings)).toEqual(settings)
    expect(
      httpContracts.getSettings.response.safeParse({
        ...settings,
        deepgram_api_key: "private-value",
      }).success
    ).toBe(false)
    expect(
      httpContracts.getSettings.response.safeParse({
        ...settings,
        provider_instances: {
          custom: {
            instanceId: "custom",
            driver: "openai",
            enabled: true,
            environment: [],
            config: { nested: { accessToken: "private-value" } },
          },
        },
      }).success
    ).toBe(false)
    expect(httpContracts.getSettings.response.safeParse({}).success).toBe(false)
  })

  it("preserves journal extensions and dispatch state in messages", () => {
    const message = {
      id: "m",
      role: "user",
      content: "saved",
      createdAt: "2026-09-05T00:00:00Z",
      dispatchStatus: "uncertain",
      futureMetadata: { receipt: "r" },
    }
    expect(httpContracts.listMessages.response.parse([message])).toEqual([
      message,
    ])
    expect(
      httpContracts.listMessages.response.safeParse([
        { ...message, content: 42 },
      ]).success
    ).toBe(false)
  })

  it("reads legacy tool calls and tool-role messages without losing their content", () => {
    const [message] = httpContracts.listMessages.response.parse([
      {
        id: "tool-result",
        role: "tool",
        content: "file contents",
        createdAt: "2026-09-05T00:00:00Z",
        toolCalls: [{ id: "old-tool", name: "Read", input: { path: "a.txt" } }],
      },
    ])
    expect(message.role).toBe("tool")
    expect(message.content).toBe("file contents")
    expect(message.toolCalls?.[0]).toEqual({
      id: "old-tool",
      name: "Read",
      input: { path: "a.txt" },
      state: "input-available",
    })
    const [completed] = httpContracts.listMessages.response.parse([
      {
        ...message,
        toolCalls: [
          { id: "old-tool", name: "Read", input: {}, output: "done" },
        ],
      },
    ])
    expect(completed.toolCalls?.[0].state).toBe("output-available")
  })

  it("encodes thread ids and accepts the established 204 write response", async () => {
    const transport = vi.fn().mockResolvedValue(undefined)
    await requestHttpContract("saveMessage", transport, {
      id: "a/b?c",
      body: {
        id: "m",
        role: "user",
        content: "hi",
        createdAt: "2026-09-05T00:00:00Z",
      },
    })
    expect(transport.mock.calls[0][0].path).toBe("/threads/a%2Fb%3Fc/messages")
  })

  it("masks an invalid backend success response instead of returning it to clients", async () => {
    const api = new Hono()
    api.post("/chat/approval", (c) =>
      handleHttpContract(
        c,
        "chatApproval",
        async () => {
          // Simulate a runtime adapter violation; the normal handler is checked statically.
          return { status: "private-value" } as never
        },
        { operation: "chat approval" }
      )
    )
    const result = await api.request("/chat/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "t",
        requestId: "r",
        decision: "approve",
        providerKind: "codex",
      }),
    })
    expect(result.status).toBe(500)
    expect(await result.text()).not.toContain("private-value")
  })
})
