import { randomUUID } from "node:crypto"
import {
  approvalRequestId,
  threadId,
  type ProviderAdapterShape,
  type ProviderApprovalDecision,
  type ProviderKind,
  type ProviderRuntimeEvent,
} from "./contracts"
import {
  configuredAgentAllowMayAutoApprove,
  listConfiguredAgentPermissionGrants,
  updateAgentPermissionRuntimeLevel,
} from "../agent-permission-runtime"
import { normalizeLevel } from "../permissions"
import { decideHubApproval } from "./hubApprovalPolicy"

interface ApprovalInstance {
  readonly instanceId: string
  readonly provider?: ProviderKind | null
  readonly adapter: Pick<ProviderAdapterShape, "provider" | "respondToRequest">
}

type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions"

/** Live requests only; the runtime event journal remains the durable source. */
export class HubApprovalRequests {
  private readonly pending = new Map<
    string,
    { instance: ApprovalInstance; event: ProviderRuntimeEvent }
  >()
  private readonly responses = new Map<string, Promise<void>>()

  constructor(
    private readonly callbacks: {
      emit: (event: ProviderRuntimeEvent, provider: ProviderKind) => void
      onError: (
        event: ProviderRuntimeEvent,
        instanceId: string,
        provider: ProviderKind,
        error: unknown
      ) => void
    }
  ) {}

  updatePermissionMode(
    thread: string,
    mode: PermissionMode,
    permissionLevel?: string
  ): {
    nativeMode: PermissionMode | null
    applied: "live" | "queued"
  } {
    const level =
      permissionLevel ??
      (mode === "bypassPermissions"
        ? "bypass"
        : mode === "acceptEdits"
          ? "allow-edits"
          : mode === "plan"
            ? "read-only"
            : "ask-on-edit")
    const context = updateAgentPermissionRuntimeLevel(thread, level)
    const mayAutoApprove = configuredAgentAllowMayAutoApprove(thread)
    const bypass = normalizeLevel(level) === "bypass"
    const restrictiveGrants = listConfiguredAgentPermissionGrants(thread).some(
      (grant) => grant.behavior !== "allow"
    )
    return {
      // Never remove a native ceiling or durable grant to implement a preset.
      nativeMode:
        normalizeLevel(level) === "read-only" ||
        context?.chatMode === "plan" ||
        context?.chatMode === "ask"
          ? null
          : bypass && (!mayAutoApprove || restrictiveGrants)
            ? "default"
            : mode,
      applied: context && bypass && mayAutoApprove ? "live" : "queued",
    }
  }

  /** Called only after the request has entered the hub's journal/delivery lane. */
  observe(instance: ApprovalInstance, event: ProviderRuntimeEvent): void {
    const key = this.key(instance, event)
    if (
      event.type === "request.opened" &&
      event.kind === "tool_approval" &&
      event.requestId
    ) {
      this.pending.set(key, { instance, event })
      void this.apply(instance, event).catch(() => undefined)
    } else if (event.type === "request.resolved") {
      this.pending.delete(key)
    } else if (
      event.type === "turn.completed" ||
      event.type === "turn.aborted" ||
      event.type === "session.exited"
    ) {
      for (const [pendingKey, pending] of this.pending) {
        if (
          pending.instance === instance &&
          pending.event.threadId === event.threadId
        )
          this.pending.delete(pendingKey)
      }
    }
  }

  async reconcile(instance: ApprovalInstance, thread: string): Promise<void> {
    for (const pending of [...this.pending.values()]) {
      if (pending.instance === instance && pending.event.threadId === thread)
        await this.apply(instance, pending.event)
    }
  }

  private async apply(
    instance: ApprovalInstance,
    event: ProviderRuntimeEvent
  ): Promise<void> {
    const decision = decideHubApproval(event)
    if (decision.kind === "ignore") return
    if (decision.kind === "deny-ceiling") {
      await this.respond(instance, event, {
        kind: "tool_approval",
        decision: "deny",
        message: decision.reason,
      })
      return
    }
    if (decision.decision === "deny") {
      this.callbacks.emit(
        {
          threadId: event.threadId,
          providerKind:
            event.providerKind ??
            instance.provider ??
            instance.adapter.provider,
          providerInstanceId: event.providerInstanceId ?? instance.instanceId,
          eventId: randomUUID(),
          at: Date.now(),
          type: "tool.denied",
          turnId: event.turnId,
          payload: { toolName: decision.toolName, reason: decision.reason },
        } as ProviderRuntimeEvent,
        instance.provider ?? instance.adapter.provider
      )
      await this.respond(instance, event, {
        kind: "tool_approval",
        decision: "deny",
        message: decision.reason,
      })
      return
    }
    await this.respond(instance, event, {
      kind: "tool_approval",
      decision: "approve",
    })
  }

  private respond(
    instance: ApprovalInstance,
    event: ProviderRuntimeEvent,
    decision: ProviderApprovalDecision
  ): Promise<void> {
    const request = event.requestId
    if (!request) return Promise.resolve()
    const key = this.key(instance, event)
    const inFlight = this.responses.get(key)
    if (inFlight) return inFlight
    const response = Promise.resolve()
      .then(() =>
        instance.adapter.respondToRequest(
          threadId(event.threadId),
          approvalRequestId(request),
          decision
        )
      )
      .then(() => {
        this.pending.delete(key)
      })
      .catch((error: unknown) => {
        this.callbacks.onError(
          event,
          instance.instanceId,
          instance.provider ?? instance.adapter.provider,
          error
        )
        throw error
      })
      .finally(() => {
        this.responses.delete(key)
      })
    this.responses.set(key, response)
    return response
  }

  private key(instance: ApprovalInstance, event: ProviderRuntimeEvent): string {
    return JSON.stringify([
      instance.instanceId,
      event.threadId,
      event.requestId,
    ])
  }
}
