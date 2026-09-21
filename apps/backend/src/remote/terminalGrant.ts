import type { RemoteAccessSession } from "./service"

interface TerminalGrantSettings {
  readonly remote_access_allow_terminal?: boolean
}

/**
 * Whether a settings change took the terminal grant away from paired
 * devices. Only the true→false edge counts: the grant being off on both
 * sides (or never having been on) has nothing to tear down.
 */
export function remoteTerminalGrantRevoked(
  previous: TerminalGrantSettings,
  next: TerminalGrantSettings
): boolean {
  return (
    previous.remote_access_allow_terminal === true
    && next.remote_access_allow_terminal !== true
  )
}

/**
 * Process owners whose shells and PTYs must end when the terminal grant is
 * revoked: every live paired session, addressed the way the shell routes
 * register ownership (`remote:<sessionId>`). Same teardown the session
 * revocation path runs — the sessions themselves stay valid, only their
 * terminals go.
 */
export function remoteTerminalRevocationOwners(
  sessions: ReadonlyArray<Pick<RemoteAccessSession, "id">>
): string[] {
  const owners = new Set<string>()
  for (const session of sessions) {
    if (session.id) owners.add(`remote:${session.id}`)
  }
  return [...owners]
}
