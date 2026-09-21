/**
 * The activity sequence counter and the row constructor every family uses.
 */

import { type ThreadActivity } from "@/lib/chat-store"
import { payloadTurnId, providerInstanceIdFromPayload } from "../payload"

/**
 * The next sequence `makeActivity` will assign; used for ids of events
 * that carry no stable id of their own.
 */
export function upcomingActivitySequence(): number {
  return activitySequence + 1
}

let activitySequence = Date.now() * 1000

export function makeActivity(
  threadId: string,
  kind: string,
  tone: ThreadActivity["tone"],
  summary: string,
  payload: Record<string, unknown>,
  idParts: (string | number | undefined | null)[]
): ThreadActivity {
  activitySequence += 1
  return {
    id: idParts
      .filter(
        (part): part is string | number =>
          part !== undefined && part !== null && `${part}`.length > 0
      )
      .map((part) => `${part}`.replace(/\s+/g, "_"))
      .join("::"),
    threadId,
    turnId: payloadTurnId(payload) ?? null,
    providerInstanceId: providerInstanceIdFromPayload(payload) ?? null,
    kind,
    tone,
    summary,
    payload,
    sequence: activitySequence,
    createdAt: new Date().toISOString(),
  }
}
