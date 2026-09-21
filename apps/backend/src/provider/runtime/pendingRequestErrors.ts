import type { ApprovalRequestId } from "./contracts";

export type PendingProviderRequestKind =
  | "approval"
  | "user-input"
  | "plan-approval";

export function stalePendingRequestDetail(
  kind: PendingProviderRequestKind,
  requestId: ApprovalRequestId | string,
): string {
  return `Stale pending ${kind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

export class StalePendingProviderRequestError extends Error {
  readonly requestKind: PendingProviderRequestKind;
  readonly requestId: string;

  constructor(kind: PendingProviderRequestKind, requestId: ApprovalRequestId | string) {
    super(stalePendingRequestDetail(kind, requestId));
    this.name = "StalePendingProviderRequestError";
    this.requestKind = kind;
    this.requestId = String(requestId);
  }
}

export function pendingRequestKindFromDecisionKind(
  decisionKind:
    | "tool_approval"
    | "user_input"
    | "user_input_reject"
    | "plan_approval",
): PendingProviderRequestKind {
  if (decisionKind === "user_input" || decisionKind === "user_input_reject") {
    return "user-input";
  }
  if (decisionKind === "plan_approval") {
    return "plan-approval";
  }
  return "approval";
}
