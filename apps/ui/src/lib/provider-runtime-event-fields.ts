const canonicalRuntimeEventFieldKeys = [
  "provider",
  "providerKind",
  "provider_kind",
  "providerInstanceId",
  "provider_instance_id",
  "eventId",
  "event_id",
  "createdAt",
  "created_at",
  "at",
  "turnId",
  "turn_id",
  "itemId",
  "item_id",
  "requestId",
  "request_id",
  "providerRefs",
  "provider_refs",
  "raw",
  "id",
  "streamKind",
  "stream_kind",
  "delta",
  "text",
  "kind",
  "itemType",
  "item_type",
  "toolId",
  "tool_id",
  "toolName",
  "tool_name",
  "tool",
  "input",
  "output",
  "title",
  "questions",
  "requestType",
  "request_type",
  "requestKind",
  "request_kind",
  "decision",
  "status",
  "state",
  "error",
  "errorMessage",
  "error_message",
  "usage",
  "model",
  "effort",
  "planId",
  "plan_id",
  "planMarkdown",
  "plan_markdown",
  "implementedAt",
  "implemented_at",
  "implementationThreadId",
  "implementation_thread_id",
  "sourceProposedPlan",
  "source_proposed_plan",
  "message",
  "resume",
  "reason",
  "detail",
  "recoverable",
  "exitKind",
  "exit_kind",
  "class",
  "willRetry",
  "will_retry",
] as const

export function mergeCanonicalRuntimeEventFields(
  payload: Record<string, unknown> | undefined,
  event: Record<string, unknown> | undefined
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(payload ?? {}) }
  if (!event) return merged

  for (const key of canonicalRuntimeEventFieldKeys) {
    const value = event[key]
    if (value !== undefined && merged[key] === undefined) {
      merged[key] = value
    }
  }

  return merged
}
