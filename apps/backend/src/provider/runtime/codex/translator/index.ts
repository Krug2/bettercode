import type { CodexNativeEvent } from "../CodexSessionRuntime"
import type { ProviderRuntimeEvent } from "../../contracts"
import type { CodexNotificationContext } from "./context"
import { _logXlat } from "./shared"
import { translateProcessEvents } from "./process-events"
import { translateSessionEvents } from "./session-events"
import { translateStreamEvents } from "./stream-events"
import { translateTurnEvents } from "./turn-events"
import { translateItemEvents } from "./item-events"
import { translateAccountEvents } from "./account-events"

export type { CodexNotificationContext } from "./context"

/**
 * Notification families in the order they are tried. Each matches on the
 * method name alone and the methods are disjoint, so the order only decides
 * which file a reader opens first.
 */
const NOTIFICATION_TRANSLATORS: ReadonlyArray<
  (ctx: CodexNotificationContext) => ProviderRuntimeEvent[] | null
> = [
  translateSessionEvents,
  translateStreamEvents,
  translateTurnEvents,
  translateItemEvents,
  translateAccountEvents,
]

/**
 * Turns one native Codex event (a JSON-RPC notification, a server request or
 * a child-process signal) into the canonical provider runtime events it
 * stands for. An unknown notification yields no events.
 */
export function translateCodexEvent(
  threadId: string,
  native: CodexNativeEvent
): ProviderRuntimeEvent[] {
  const out = translateCodexEventInner(threadId, native)
  _logXlat(native, out)
  return out
}

function translateCodexEventInner(
  threadId: string,
  native: CodexNativeEvent
): ProviderRuntimeEvent[] {
  const processEvents = translateProcessEvents(threadId, native)
  if (processEvents) return processEvents

  const ctx: CodexNotificationContext = {
    threadId,
    native,
    method: native.method!,
    params: native.params ?? {},
  }
  for (const translate of NOTIFICATION_TRANSLATORS) {
    const out = translate(ctx)
    if (out) return out
  }
  return []
}
