import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import {
  getProviderUpdateSidebarPillView,
  type ProviderUpdateSidebarPillView,
} from "./provider-update-notification"

export interface ProviderUpdateSession {
  readonly providers: ReadonlyArray<ProviderInstanceSnapshot>
  readonly since?: string
  readonly dismissed: ReadonlySet<string>
  readonly notice: ProviderUpdateSidebarPillView | null
}

type SessionEvent =
  | { type: "snapshot"; providers: ReadonlyArray<ProviderInstanceSnapshot> }
  | { type: "dismiss"; key: string }

function project(
  session: Omit<ProviderUpdateSession, "notice">
): ProviderUpdateSession {
  let since = session.since
  if (since === undefined) {
    // Ignore cached completions from before this sidebar session. Compare actual
    // instants because provider snapshots can contain different UTC offsets.
    let newest = -Infinity
    for (const provider of session.providers) {
      const checkedAt = Date.parse(provider.checkedAt)
      if (Number.isFinite(checkedAt)) newest = Math.max(newest, checkedAt)
    }
    if (Number.isFinite(newest)) since = new Date(newest).toISOString()
  }
  return {
    ...session,
    since,
    notice: getProviderUpdateSidebarPillView(session.providers, {
      visibleAfterIso: since,
      dismissedKeys: session.dismissed,
    }),
  }
}

export function createProviderUpdateSession(
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): ProviderUpdateSession {
  return project({ providers, dismissed: new Set() })
}

export function reduceProviderUpdateSession(
  session: ProviderUpdateSession,
  event: SessionEvent
): ProviderUpdateSession {
  if (event.type === "snapshot") {
    if (
      event.providers.length === session.providers.length &&
      event.providers.every(
        (provider, index) => provider === session.providers[index]
      )
    )
      return session
    return project({ ...session, providers: event.providers })
  }
  // A timeout from a replaced notice must never hide a newer result.
  if (session.notice?.key !== event.key || session.notice.tone === "loading")
    return session
  return project({
    ...session,
    dismissed: new Set([...session.dismissed, event.key]),
  })
}
