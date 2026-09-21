import type { ProviderRuntimeEvent } from "./contracts"

/**
 * Stamps the hub's dispatch turn id onto the three turn-lifecycle events so
 * the ingestion lane and the checkpoint reactor can correlate a provider's
 * native turn with the dispatch that started it. Every adapter does this the
 * same way; keep it here rather than pasting it into each one.
 */
export function withDispatchTurnId(
  event: ProviderRuntimeEvent,
  dispatchTurnId: string | null
): ProviderRuntimeEvent {
  if (
    !dispatchTurnId ||
    (event.type !== "turn.started" &&
      event.type !== "turn.completed" &&
      event.type !== "turn.aborted")
  ) {
    return event
  }
  const payload = (
    event as unknown as { readonly payload?: Record<string, unknown> }
  ).payload
  return {
    ...event,
    payload: {
      ...(payload ?? {}),
      dispatchTurnId,
    },
  } as ProviderRuntimeEvent
}
