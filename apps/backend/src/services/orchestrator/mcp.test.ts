import fs from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  chatSendSchema,
  orchestratorJobSchema,
  orchestratorContextSchema,
  orchestratorTeamSchema,
  providerRuntimeEventSchema,
} from "@betterc0de/schema"
import { OrchestratorService } from "./service"
import { OrchestratorMcpHarness } from "./mcp"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture() {
  const cwd = await fs.realpath(process.cwd())
  const settings = {
    orchestrator_enabled: true,
    orchestrator_team: orchestratorTeamSchema.parse({
      main: {
        providerKind: "claude",
        providerInstanceId: "claude",
        modelId: "main",
      },
      members: [
        {
          id: "builder",
          name: "Builder",
          role: "Implement",
          providerKind: "codex",
          providerInstanceId: "codex",
          modelId: "gpt-6-astra",
        },
      ],
    }),
  }
  const dispatch = vi.fn(async () => undefined)
  const service = new OrchestratorService({
    settings: () => settings,
    allowed: () => true,
    load: () => null,
    persist: () => {},
    createThread: () => {},
    modelCatalog: async () => settings.orchestrator_team.members,
    readContextSource: (source) => ({
      source,
      title: "Plan",
      body: "Use the agreed plan.",
      truncated: false,
    }),
    dispatch,
    interrupt: async () => {},
    reportError: (error) => {
      throw error
    },
  })
  const harness = new OrchestratorMcpHarness(service)
  cleanups.push(
    () => service.close(),
    () => harness.close()
  )
  const session = await service.start(cwd)
  expect(await harness.resolveServer(cwd, session.threadId)).toBeNull()
  service.prepareTurn(
    chatSendSchema.parse({
      threadId: session.threadId,
      providerKind: "claude",
      providerInstanceId: "claude",
      modelId: "main",
      projectPath: cwd,
      chatMode: "agent",
      message: "Work",
    })
  )
  const server = await harness.resolveServer(cwd, session.threadId)
  if (!server) throw new Error("Coordinator tools missing")
  const client = new Client({ name: "orchestrator-test", version: "1.0" })
  cleanups.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    })
  )
  return { service, harness, settings, session, server, client, cwd, dispatch }
}

describe("coordinator-scoped MCP harness", () => {
  it("gives workers scoped context tools without delegation or arbitrary thread reads", async () => {
    const f = await fixture()
    const job = f.service.spawn(
      f.session.threadId,
      "builder",
      "Use the plan",
      "worker"
    )
    const grant = f.service.grantContext({
      threadId: f.session.threadId,
      requestId: "grant",
      recipient: { kind: "member", memberId: "builder" },
      content: { kind: "plan", threadId: "source" },
    })
    const server = await f.harness.resolveServer(f.cwd, job.threadId)
    if (!server) throw new Error("Worker context server missing")
    const client = new Client({ name: "worker-context-test", version: "1" })
    cleanups.push(() => client.close())
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      })
    )
    expect(
      (await client.listTools()).tools.map((tool) => tool.name).sort()
    ).toEqual(["context_inbox", "read_context", "share_context"])
    const inbox = await client.callTool({
      name: "context_inbox",
      arguments: {},
    })
    expect(inbox.structuredContent).toMatchObject({
      self: { kind: "member", memberId: "builder" },
      items: [{ id: grant.id }],
    })
    expect(JSON.stringify(inbox.structuredContent)).not.toContain(
      "Use the agreed plan."
    )
    const read = orchestratorContextSchema.parse(
      (
        await client.callTool({
          name: "read_context",
          arguments: { contextId: grant.id },
        })
      ).structuredContent
    )
    expect(read.body).toBe("Use the agreed plan.")
    expect(read.readBy).toHaveLength(1)
    expect(
      (
        await client.callTool({
          name: "share_context",
          arguments: {
            requestId: "steal",
            recipient: { kind: "team" },
            content: { kind: "thread", threadId: "unrelated" },
          },
        })
      ).isError
    ).toBe(true)
    expect(
      (
        await client.callTool({
          name: "spawn_task",
          arguments: {
            requestId: "forbidden",
            memberId: "builder",
            task: "Delegate",
          },
        })
      ).isError
    ).toBe(true)
    const forwarded = orchestratorContextSchema.parse(
      (
        await client.callTool({
          name: "share_context",
          arguments: {
            requestId: "forward",
            recipient: { kind: "main" },
            content: { kind: "forward", contextId: grant.id },
          },
        })
      ).structuredContent
    )
    expect(f.service.readContext(f.session.threadId, forwarded.id).body).toBe(
      read.body
    )
    expect(
      (await f.client.callTool({ name: "team_members", arguments: {} }))
        .structuredContent
    ).toMatchObject({ session: { context: [] } })
    await f.service.cancelTask(f.session.threadId, job.id)
    await expect(
      client.callTool({ name: "context_inbox", arguments: {} })
    ).rejects.toThrow()
  })
  it("runs real MCP discovery, delegation, result collection and cancellation with typed output", async () => {
    const f = await fixture()
    const tools = (await f.client.listTools()).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "available_models",
      "cancel_task",
      "context_inbox",
      "read_context",
      "share_context",
      "spawn_agent",
      "spawn_task",
      "task_status",
      "team_members",
      "wait_task",
    ])
    expect(tools.every((tool) => tool.outputSchema)).toBe(true)
    expect(
      (await f.client.callTool({ name: "available_models", arguments: {} }))
        .structuredContent
    ).toEqual({
      models: [
        {
          modelKey: "builder",
          name: "Builder",
          providerKind: "codex",
          providerInstanceId: "codex",
          modelId: "gpt-6-astra",
          reasoningEffort: null,
        },
      ],
    })
    const job = orchestratorJobSchema.parse(
      (
        await f.client.callTool({
          name: "spawn_agent",
          arguments: {
            modelKey: "builder",
            name: "Config engineer",
            role: "Own configuration and its tests",
            requestId: "one",
            task: "Update the config",
          },
        })
      ).structuredContent
    )
    expect(f.dispatch).toHaveBeenCalledOnce()
    expect(job).toMatchObject({
      name: "Config engineer",
      role: "Own configuration and its tests",
    })
    expect(await f.harness.resolveServer(f.cwd, job.threadId)).not.toBeNull()
    f.service.onEvent(
      providerRuntimeEventSchema.parse({
        type: "content.delta",
        eventId: "delta",
        threadId: job.threadId,
        at: Date.now(),
        streamKind: "assistant_text",
        delta: "Config updated. Tests pass.",
      })
    )
    f.service.onEvent(
      providerRuntimeEventSchema.parse({
        type: "turn.completed",
        eventId: "done",
        threadId: job.threadId,
        at: Date.now(),
        status: "completed",
      })
    )
    const result = orchestratorJobSchema.parse(
      (
        await f.client.callTool({
          name: "wait_task",
          arguments: { taskId: job.id },
        })
      ).structuredContent
    )
    expect(result).toMatchObject({
      status: "completed",
      output: "Config updated. Tests pass.",
    })
    expect(
      (
        await f.client.callTool({
          name: "spawn_task",
          arguments: { memberId: "unknown", requestId: "two", task: "Work" },
        })
      ).isError
    ).toBe(true)
    expect(
      (
        await f.client.callTool({
          name: "spawn_task",
          arguments: { memberId: "builder", requestId: "three", task: "" },
        })
      ).isError
    ).toBe(true)
  })

  it("denies forged credentials, browser origins, thread impersonation and revoked capabilities", async () => {
    const f = await fixture()
    const request = (headers: Record<string, string>) =>
      fetch(f.server.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    expect((await request({})).status).toBe(403)
    expect(
      (await request({ Authorization: "Bearer forged.invalid" })).status
    ).toBe(403)
    expect(
      (await request({ ...f.server.headers, Origin: "http://attacker.test" }))
        .status
    ).toBe(403)
    const authorization = f.server.headers.Authorization
    const signature = authorization?.split(".").at(-1)
    const forgedScope = Buffer.from(
      JSON.stringify({ cwd: f.cwd, threadId: "another-thread" })
    ).toString("base64url")
    expect(
      (await request({ Authorization: `Bearer ${forgedScope}.${signature}` }))
        .status
    ).toBe(403)
    f.settings.orchestrator_enabled = false
    f.service.settingsChanged()
    expect((await request({ ...f.server.headers })).status).toBe(403)
    expect(await f.harness.resolveServer(f.cwd, f.session.threadId)).toBeNull()
  })
})
