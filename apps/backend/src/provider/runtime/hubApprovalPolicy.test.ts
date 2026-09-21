import { describe, expect, it, vi } from "vitest"
import type { ProviderRuntimeEvent } from "./contracts"
import {
  ASK_MODE_DENY_MESSAGE,
  PLAN_MODE_DENY_MESSAGE,
} from "../shared/chat-mode-tools"
import {
  decideHubApproval,
  evaluateModeCeiling,
  readApprovalRequestTool,
  resolveDurableApprovalDecision,
  type HubApprovalPolicyDeps,
} from "./hubApprovalPolicy"

const READ_ONLY_REASON = "Read-only mode — only read tools are allowed."

function approvalRequest(
  overrides: Partial<Extract<ProviderRuntimeEvent, { type: "request.opened" }>> = {}
): ProviderRuntimeEvent {
  return {
    threadId: "thread-1",
    providerKind: "codex",
    providerInstanceId: "codex-main",
    eventId: "evt-1",
    at: 1,
    type: "request.opened",
    requestId: "req-1",
    kind: "tool_approval",
    tool: "Bash",
    input: { command: "rm -rf build" },
    turnId: "turn-1",
    ...overrides,
  } as ProviderRuntimeEvent
}

function deps(overrides: Partial<HubApprovalPolicyDeps> = {}): HubApprovalPolicyDeps {
  return {
    currentAgentPermissionRuntimeContext: vi.fn(() => null),
    evaluateConfiguredAgentToolPermission: vi.fn(() => null),
    configuredAgentAllowMayAutoApprove: vi.fn(() => true),
    ...overrides,
  }
}

describe("readApprovalRequestTool", () => {
  it("ignores everything that is not an answerable tool approval", () => {
    expect(
      readApprovalRequestTool({
        threadId: "t",
        providerKind: "codex",
        eventId: "e",
        at: 1,
        type: "session.exited",
        payload: { reason: "x", exitKind: "graceful" },
      } as ProviderRuntimeEvent)
    ).toBeNull()
    expect(
      readApprovalRequestTool(approvalRequest({ kind: "user_input" }))
    ).toBeNull()
    expect(
      readApprovalRequestTool(approvalRequest({ requestId: undefined }))
    ).toBeNull()
  })

  it("prefers the explicit tool and input, then the canonical payload", () => {
    expect(readApprovalRequestTool(approvalRequest())).toEqual({
      toolName: "Bash",
      toolInput: { command: "rm -rf build" },
    })
    expect(
      readApprovalRequestTool(
        approvalRequest({
          tool: undefined,
          input: undefined,
          payload: { requestType: "command_execution", args: ["ls"] },
        })
      )
    ).toEqual({ toolName: "command_execution", toolInput: ["ls"] })
    expect(
      readApprovalRequestTool(
        approvalRequest({ tool: undefined, input: undefined, payload: undefined })
      )
    ).toEqual({ toolName: "tool", toolInput: undefined })
  })
})

describe("evaluateModeCeiling", () => {
  const cases: ReadonlyArray<{
    readonly chatMode: string | null
    readonly permissionLevel: string | null
    readonly toolName: string
    readonly expected: string | null
  }> = [
    // Plan mode: only reads pass.
    { chatMode: "plan", permissionLevel: null, toolName: "Read", expected: null },
    { chatMode: "plan", permissionLevel: null, toolName: "Edit", expected: PLAN_MODE_DENY_MESSAGE },
    { chatMode: "plan", permissionLevel: null, toolName: "Bash", expected: PLAN_MODE_DENY_MESSAGE },
    { chatMode: "plan", permissionLevel: null, toolName: "mcp__x__read_and_apply", expected: PLAN_MODE_DENY_MESSAGE },
    // Ask mode: same shape, its own message.
    { chatMode: "ask", permissionLevel: null, toolName: "Grep", expected: null },
    { chatMode: "ask", permissionLevel: null, toolName: "Write", expected: ASK_MODE_DENY_MESSAGE },
    { chatMode: "ask", permissionLevel: null, toolName: "Bash", expected: ASK_MODE_DENY_MESSAGE },
    { chatMode: "ask", permissionLevel: null, toolName: "unknown_tool", expected: ASK_MODE_DENY_MESSAGE },
    // Read-only permission level, any chat mode.
    { chatMode: "agent", permissionLevel: "read-only", toolName: "Glob", expected: null },
    { chatMode: "agent", permissionLevel: "read-only", toolName: "Edit", expected: READ_ONLY_REASON },
    { chatMode: null, permissionLevel: "read", toolName: "Bash", expected: READ_ONLY_REASON },
    { chatMode: null, permissionLevel: "read-only", toolName: "anything", expected: READ_ONLY_REASON },
    // Plan wins over a read-only level for the message.
    { chatMode: "PLAN ", permissionLevel: "read-only", toolName: "Edit", expected: PLAN_MODE_DENY_MESSAGE },
    // Permissive modes never hit the ceiling.
    { chatMode: "agent", permissionLevel: "allow-edits", toolName: "Edit", expected: null },
    { chatMode: "agent", permissionLevel: "bypass", toolName: "Bash", expected: null },
    { chatMode: null, permissionLevel: "ask-on-edit", toolName: "unknown_tool", expected: null },
    { chatMode: null, permissionLevel: null, toolName: "Bash", expected: null },
  ]

  it.each(cases)(
    "chatMode=$chatMode level=$permissionLevel tool=$toolName -> $expected",
    ({ chatMode, permissionLevel, toolName, expected }) => {
      const result = evaluateModeCeiling({ chatMode, permissionLevel, toolName })
      expect(result?.reason ?? null).toBe(expected)
    }
  )
})

describe("resolveDurableApprovalDecision", () => {
  const input = { threadId: "thread-1", toolName: "Bash", toolInput: { command: "ls" } }

  it("leaves the request to the provider without a configured policy", () => {
    expect(resolveDurableApprovalDecision(input, deps())).toBeNull()
  })

  it("ignores default-source decisions and explicit asks", () => {
    expect(
      resolveDurableApprovalDecision(
        input,
        deps({
          evaluateConfiguredAgentToolPermission: () => ({
            decision: "allow",
            source: "default",
            reason: "default",
          }),
        })
      )
    ).toBeNull()
    expect(
      resolveDurableApprovalDecision(
        input,
        deps({
          evaluateConfiguredAgentToolPermission: () => ({
            decision: "ask",
            source: "grant",
            reason: "ask",
          }),
        })
      )
    ).toBeNull()
  })

  it("applies a deny grant with its reason", () => {
    expect(
      resolveDurableApprovalDecision(
        input,
        deps({
          evaluateConfiguredAgentToolPermission: () => ({
            decision: "deny",
            source: "grant",
            reason: "Denied by workspace grant",
          }),
        })
      )
    ).toEqual({ decision: "deny", reason: "Denied by workspace grant" })
  })

  it("applies an allow grant only where the mode may auto-approve", () => {
    const allowGrant = () => ({
      decision: "allow" as const,
      source: "grant" as const,
      reason: "allowed",
    })
    expect(
      resolveDurableApprovalDecision(
        input,
        deps({
          evaluateConfiguredAgentToolPermission: allowGrant,
          configuredAgentAllowMayAutoApprove: () => true,
        })
      )
    ).toEqual({ decision: "allow" })
    expect(
      resolveDurableApprovalDecision(
        input,
        deps({
          evaluateConfiguredAgentToolPermission: allowGrant,
          configuredAgentAllowMayAutoApprove: () => false,
        })
      )
    ).toBeNull()
  })

  it("forwards the tool identity to the policy evaluator", () => {
    const evaluate = vi.fn(() => null)
    resolveDurableApprovalDecision(input, deps({ evaluateConfiguredAgentToolPermission: evaluate }))
    expect(evaluate).toHaveBeenCalledWith({
      threadId: "thread-1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    })
  })
})

describe("decideHubApproval", () => {
  it("ignores non-approval events without consulting the runtime context", () => {
    const context = vi.fn(() => null)
    const decision = decideHubApproval(
      approvalRequest({ kind: "user_input" }),
      deps({ currentAgentPermissionRuntimeContext: context })
    )
    expect(decision).toEqual({ kind: "ignore" })
    expect(context).not.toHaveBeenCalled()
  })

  it("applies the mode ceiling before any durable grant", () => {
    const evaluate = vi.fn(() => ({
      decision: "allow" as const,
      source: "grant" as const,
      reason: "allowed",
    }))
    const decision = decideHubApproval(
      approvalRequest({ tool: "Edit" }),
      deps({
        currentAgentPermissionRuntimeContext: () => ({
          threadId: "thread-1",
          chatMode: "plan",
        }),
        evaluateConfiguredAgentToolPermission: evaluate,
      })
    )
    expect(decision).toEqual({
      kind: "deny-ceiling",
      toolName: "Edit",
      reason: PLAN_MODE_DENY_MESSAGE,
    })
    expect(evaluate).not.toHaveBeenCalled()
  })

  it("lets reads through the ceiling and on to the durable policy", () => {
    const decision = decideHubApproval(
      approvalRequest({ tool: "Read" }),
      deps({
        currentAgentPermissionRuntimeContext: () => ({
          threadId: "thread-1",
          chatMode: "plan",
        }),
        evaluateConfiguredAgentToolPermission: () => ({
          decision: "deny",
          source: "grant",
          reason: "Denied by grant",
        }),
      })
    )
    expect(decision).toEqual({
      kind: "durable",
      toolName: "Read",
      decision: "deny",
      reason: "Denied by grant",
    })
  })

  it("returns a durable allow when the grant may auto-approve", () => {
    const decision = decideHubApproval(
      approvalRequest(),
      deps({
        evaluateConfiguredAgentToolPermission: () => ({
          decision: "allow",
          source: "grant",
          reason: "allowed",
        }),
      })
    )
    expect(decision).toEqual({
      kind: "durable",
      toolName: "Bash",
      decision: "allow",
    })
  })
})
