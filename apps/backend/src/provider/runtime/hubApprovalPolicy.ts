import type { ProviderRuntimeEvent } from "./contracts"
import {
  configuredAgentAllowMayAutoApprove,
  currentAgentPermissionRuntimeContext,
  evaluateConfiguredAgentToolPermission,
  type AgentPermissionRuntimeContext,
  type ConfiguredAgentToolPermissionInput,
} from "../agent-permission-runtime"
import type { AgentPermissionPolicyDecision } from "../agent-permission-policy"
import { normalizeLevel } from "../permissions"
import {
  ASK_MODE_DENY_MESSAGE,
  classifyToolPermission,
  PLAN_MODE_DENY_MESSAGE,
} from "../shared/chat-mode-tools"

/**
 * The hub's provider-neutral approval policy, as pure decisions. The hub
 * owns the side effects (answering the provider, emitting `tool.denied`);
 * everything here can be tested with a plain event and injected deps.
 */

export interface ApprovalRequestTool {
  readonly toolName: string
  readonly toolInput: unknown
}

export interface HubApprovalPolicyDeps {
  readonly currentAgentPermissionRuntimeContext: (
    threadId: string
  ) => AgentPermissionRuntimeContext | null
  readonly evaluateConfiguredAgentToolPermission: (
    input: ConfiguredAgentToolPermissionInput
  ) => Pick<AgentPermissionPolicyDecision, "decision" | "source" | "reason"> | null
  readonly configuredAgentAllowMayAutoApprove: (threadId: string) => boolean
}

// Resolved per call, not frozen at module load, so the live bindings (and
// any test spy installed on `agent-permission-runtime`) are what the hub
// path actually consults — the same way the inlined hub code behaved.
const defaultDeps: HubApprovalPolicyDeps = {
  currentAgentPermissionRuntimeContext: (threadId) =>
    currentAgentPermissionRuntimeContext(threadId),
  evaluateConfiguredAgentToolPermission: (input) =>
    evaluateConfiguredAgentToolPermission(input),
  configuredAgentAllowMayAutoApprove: (threadId) =>
    configuredAgentAllowMayAutoApprove(threadId),
}

export type DurableApprovalDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly reason: string }

export type HubApprovalDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "deny-ceiling"
      readonly toolName: string
      readonly reason: string
    }
  | {
      readonly kind: "durable"
      readonly toolName: string
      readonly decision: "allow"
    }
  | {
      readonly kind: "durable"
      readonly toolName: string
      readonly decision: "deny"
      readonly reason: string
    }

/**
 * `null` for anything that is not an answerable tool-approval request. The
 * tool name falls back to the canonical `requestType` and finally to "tool"
 * so every request classifies to *something*.
 */
export function readApprovalRequestTool(
  event: ProviderRuntimeEvent
): ApprovalRequestTool | null {
  if (
    event.type !== "request.opened" ||
    event.kind !== "tool_approval" ||
    !event.requestId
  ) {
    return null
  }
  const payload = event.payload
  const toolName =
    event.tool ??
    (payload && typeof payload.requestType === "string"
      ? payload.requestType
      : "tool")
  const toolInput =
    event.input ??
    (payload && Object.prototype.hasOwnProperty.call(payload, "args")
      ? payload.args
      : undefined)
  return { toolName, toolInput }
}

/**
 * Hard mode ceiling, enforced in the hub so it holds for every provider.
 *
 * Adapters that own their own policy engine can only be *asked* to be
 * restrictive. Codex maps both `read-only` and `ask-on-edit` onto
 * `approvalPolicy: "untrusted"`, which means it requests escalation rather
 * than refusing — so a Plan-mode turn could still write files if the user
 * approved a prompt that never mentioned Plan mode. Plan/Ask/read-only are
 * documented as hard denials for anything that is not a read
 * (`permissions.ts`), and users treat Plan mode as a guarantee. Answer the
 * request ourselves instead of forwarding it.
 */
export function evaluateModeCeiling(input: {
  readonly chatMode: string | null | undefined
  readonly permissionLevel: string | null | undefined
  readonly toolName: string
}): { readonly reason: string } | null {
  const chatMode = input.chatMode == null ? "agent" : input.chatMode.trim().toLowerCase()
  const knownMode =
    chatMode === "agent" ||
    chatMode === "debug" ||
    chatMode === "plan" ||
    chatMode === "ask" ||
    chatMode === "security"
  const modeForbidsMutation =
    chatMode === "plan" ||
    chatMode === "ask" ||
    !knownMode ||
    normalizeLevel(input.permissionLevel) === "read-only"
  if (!modeForbidsMutation || classifyToolPermission(input.toolName) === "read") {
    return null
  }
  const reason =
    chatMode === "plan"
      ? PLAN_MODE_DENY_MESSAGE
      : chatMode === "ask"
        ? ASK_MODE_DENY_MESSAGE
        : "Read-only mode — only read tools are allowed."
  return { reason }
}

/**
 * A persisted user grant that the hub may apply on the user's behalf.
 * A live Bypass preset also covers default policy decisions. An explicit
 * "ask", a missing policy or a hard mode ceiling still requires a response.
 */
export function resolveDurableApprovalDecision(
  input: {
    readonly threadId: string
    readonly toolName: string
    readonly toolInput: unknown
    readonly bypass?: boolean
  },
  deps: HubApprovalPolicyDeps = defaultDeps
): DurableApprovalDecision | null {
  const policy = deps.evaluateConfiguredAgentToolPermission({
    threadId: input.threadId,
    toolName: input.toolName,
    toolInput: input.toolInput,
  })
  if (!policy) return null
  if (policy.source === "default") {
    // A live Bypass selection may answer a provider still running its original
    // approval policy. Explicit ask/deny grants and trust decisions take priority.
    return input.bypass && deps.configuredAgentAllowMayAutoApprove(input.threadId)
      ? { decision: "allow" }
      : null
  }
  if (policy.decision === "ask") {
    return null
  }
  if (
    policy.decision === "allow" &&
    !deps.configuredAgentAllowMayAutoApprove(input.threadId)
  ) {
    return null
  }
  if (policy.decision === "deny") {
    return { decision: "deny", reason: policy.reason }
  }
  return { decision: "allow" }
}

export function decideHubApproval(
  event: ProviderRuntimeEvent,
  deps: HubApprovalPolicyDeps = defaultDeps
): HubApprovalDecision {
  const tool = readApprovalRequestTool(event)
  if (!tool) return { kind: "ignore" }

  const runtimeContext = deps.currentAgentPermissionRuntimeContext(
    event.threadId
  )
  const ceiling = evaluateModeCeiling({
    chatMode: runtimeContext?.chatMode,
    permissionLevel: runtimeContext?.permissionLevel,
    toolName: tool.toolName,
  })
  if (ceiling) {
    return {
      kind: "deny-ceiling",
      toolName: tool.toolName,
      reason: ceiling.reason,
    }
  }

  const durable = resolveDurableApprovalDecision(
    {
      threadId: event.threadId,
      toolName: tool.toolName,
      toolInput: tool.toolInput,
      bypass: normalizeLevel(runtimeContext?.permissionLevel) === "bypass",
    },
    deps
  )
  if (!durable) return { kind: "ignore" }
  if (durable.decision === "deny") {
    return {
      kind: "durable",
      toolName: tool.toolName,
      decision: "deny",
      reason: durable.reason,
    }
  }
  return { kind: "durable", toolName: tool.toolName, decision: "allow" }
}
