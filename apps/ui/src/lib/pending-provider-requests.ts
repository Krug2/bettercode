import { asRecord } from "@betterc0de/schema"
import type { ThreadActivity } from "@betterc0de/schema"

const STALE_PENDING_REQUEST_DETAILS = [
  "stale pending approval request",
  "stale pending user-input request",
  "stale pending plan-approval request",
  "unknown pending approval request",
  "unknown pending permission request",
  "unknown pending user-input request",
  "unknown pending plan-approval request",
] as const

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function isStalePendingRequestFailureDetail(detail: unknown): boolean {
  const normalized = stringFrom(detail)?.toLowerCase()
  if (!normalized) return false
  return STALE_PENDING_REQUEST_DETAILS.some((needle) =>
    normalized.includes(needle)
  )
}

export function requestIdFromActivity(
  activity: Pick<ThreadActivity, "payload">
): string | undefined {
  const payload = asRecord(activity.payload)
  const direct = stringFrom(payload.requestId) ?? stringFrom(payload.request_id)
  if (direct) return direct

  const data = asRecord(payload.data)
  const item = asRecord(payload.item)
  return (
    stringFrom(data.requestId) ??
    stringFrom(data.request_id) ??
    stringFrom(item.requestId) ??
    stringFrom(item.request_id)
  )
}

function failureDetailFromActivity(
  activity: Pick<ThreadActivity, "payload" | "summary">
): string | undefined {
  const payload = asRecord(activity.payload)
  const data = asRecord(payload.data)
  return (
    stringFrom(payload.detail) ??
    stringFrom(payload.error) ??
    stringFrom(payload.message) ??
    stringFrom(data.detail) ??
    stringFrom(data.error) ??
    stringFrom(data.message) ??
    stringFrom(activity.summary)
  )
}

/**
 * Human-readable detail for a request response that the backend refused
 * (non-2xx) or that never reached it. Kept short: it lands on the failed
 * activity card and in a toast.
 */
export function describeRequestResponseFailure(
  error: unknown,
  fallback: string
): string {
  const message =
    error instanceof Error
      ? error.message.trim()
      : typeof error === "string"
        ? error.trim()
        : ""
  return message.length > 0 ? message : fallback
}

/**
 * Twin of the backend's `activityId` (`provider/activity-projection/shared.ts`):
 * the same parts joined the same way, so a locally recorded failure and
 * the backend's own row for the same request share one id and upsert
 * rather than stack. Kept in sync by the parity test next to this file.
 */
function backendActivityId(
  parts: ReadonlyArray<string | number | undefined | null>
): string {
  return parts
    .filter(
      (part): part is string | number =>
        part !== undefined && part !== null && `${part}`.length > 0
    )
    .map((part) => `${part}`.replace(/\s+/g, "_"))
    .join("::")
}

/**
 * Local twin of the backend's `provider.approval.respond.failed` activity.
 * The backend records and broadcasts one when the provider refuses the
 * response; this covers the request never getting there (network, 5xx
 * before the activity write) so `derivePendingApprovals` clears the card
 * either way instead of leaving a request that can no longer be answered.
 */
export function failedRequestResponseActivity(input: {
  readonly threadId: string
  readonly requestId: string
  readonly providerKind: string
  readonly providerInstanceId?: string | null
  readonly requestKind: "approval" | "plan-approval"
  readonly detail: string
  readonly now?: number
}): ThreadActivity {
  const now = input.now ?? Date.now()
  return {
    id: backendActivityId([
      input.threadId,
      "provider.approval.respond.failed",
      input.requestId,
    ]),
    threadId: input.threadId,
    kind: "provider.approval.respond.failed",
    tone: "error",
    summary:
      input.requestKind === "plan-approval"
        ? "Provider plan-approval response failed"
        : "Provider approval response failed",
    payload: {
      requestId: input.requestId,
      providerKind: input.providerKind,
      providerInstanceId: input.providerInstanceId ?? undefined,
      detail: input.detail,
    },
    sequence: now * 1000,
    createdAt: new Date(now).toISOString(),
  }
}

export function isStalePendingApprovalFailureActivity(
  activity: Pick<ThreadActivity, "kind" | "payload" | "summary">
): boolean {
  return (
    activity.kind === "provider.approval.respond.failed" &&
    isStalePendingRequestFailureDetail(failureDetailFromActivity(activity))
  )
}

export function isStalePendingUserInputFailureActivity(
  activity: Pick<ThreadActivity, "kind" | "payload" | "summary">
): boolean {
  return (
    activity.kind === "provider.user-input.respond.failed" &&
    isStalePendingRequestFailureDetail(failureDetailFromActivity(activity))
  )
}
