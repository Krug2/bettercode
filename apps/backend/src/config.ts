import path from "node:path"
import os from "node:os"
import { DEFAULT_PORT, PORT_FALLBACK_COUNT } from "./constants"
import { parseAllowedOrigins } from "./security/origin"

/**
 * Server configuration. When Electron spawns or embeds the backend it passes
 * `dataDir` explicitly (resolved via `resolveBetterC0deUserDataDir()` in
 * `electron/main.cjs`); standalone `node dist/index.js` runs compute the
 * default here and land on the same path, so both entry points read and
 * write the same SQLite file.
 */
export interface ServerConfig {
  /** HTTP/WS host. Loopback unless the user explicitly enables remote access. */
  host: string
  /** Preferred port; fallbacks are host:port+1, host:port+2, then 0 (any). */
  port: number
  /** Base data directory containing the SQLite DB + `settings.json`. */
  dataDir: string
  /** Full path to the SQLite database file. */
  dbPath: string
  /** Full path to `settings.json`. */
  settingsPath: string
  /** Full path to `auth.json` — separate file for OAuth tokens. Encrypted at
   *  rest with the same master key the settings file uses (provisioned via
   *  Electron `safeStorage`). */
  authPath: string
  /** Base logs directory under the active data directory. */
  logsDir: string
  /** Provider observability log directory. */
  providerLogsDir: string
  /** Provider event log base path; thread logs live beside it. */
  providerEventLogPath: string
  /** Bearer token issued at process start (filled in later by generateToken). */
  authToken?: string
  /** Additional browser origins allowed for explicit remote deployments. */
  allowedOrigins?: string[]
  /**
   * Trust X-Forwarded-* only when an operator has placed the backend behind
   * a known reverse proxy. Disabled by default because these headers are
   * client-controlled on a directly exposed listener.
   */
  trustProxyHeaders?: boolean
  /**
   * Trust X-Forwarded-* from loopback TCP peers only. Set while Tailscale
   * Serve is enabled in settings: that proxy terminates TLS on this machine
   * and forwards to 127.0.0.1, so its headers are the only way to tell a
   * tailnet phone from the desktop renderer. Never widens a remote peer.
   */
  trustLoopbackProxyHeaders?: boolean
  /**
   * This machine's own Tailscale addresses, from the last `tailscale status`.
   * A plaintext request whose TCP peer *and* local socket address are both
   * tailnet addresses arrived through the WireGuard tunnel from an
   * authenticated peer: private transport, no TLS required. Checking the
   * local side against these exact addresses is what rules out an ISP CGNAT
   * interface that merely shares the 100.64/10 range.
   */
  tailnetSelfAddresses?: () => ReadonlySet<string>
  /**
   * Explicit escape hatch for direct, plaintext LAN access. The secure
   * default requires TLS (normally through a reverse proxy) off loopback.
   */
  allowInsecureRemoteAccess?: boolean
  /** Heap snapshots contain secrets and are disabled unless explicitly opted in. */
  runtimeHeapSnapshotsEnabled?: boolean
}

/**
 * Default on-disk data directory. Follows the BetterC0de layout — same path on
 * every OS so docs, debugging, and the plugin sibling directory
 * (`~/.betterc0de/plugins/`) all line up:
 *   - `~/.betterc0de/userdata/`
 *
 * `BETTERC0DE_HOME=/custom/root` swaps the base — the backend then writes
 * to `/custom/root/userdata/`. `BETTERC0DE_DATA_DIR=/absolute/path` is still
 * honoured by `createServerConfig` as an even higher-priority override that
 * skips the `/userdata` suffix entirely (power-users, tests, CI).
 *
 * Startup migrates legacy directories only into the standard production or
 * development userdata path. Explicit custom profiles stay isolated; this
 * directory resolver never chooses an existing legacy path as a fallback.
 */
function defaultDataDir(): string {
  const override = (process.env.BETTERC0DE_HOME ?? "").trim()
  const base = override ? override : path.join(os.homedir(), ".betterc0de")
  return path.join(base, "userdata")
}

export function createServerConfig(
  options: { dataDir?: string; port?: number; host?: string } = {}
): ServerConfig {
  const dataDir =
    options.dataDir ?? process.env.BETTERC0DE_DATA_DIR ?? defaultDataDir()
  const port = options.port ?? DEFAULT_PORT
  const logsDir = path.join(dataDir, "logs")
  const providerLogsDir = path.join(logsDir, "provider")
  return {
    host: options.host ?? "127.0.0.1",
    port,
    dataDir,
    dbPath: path.join(dataDir, "betterc0de.db"),
    settingsPath: path.join(dataDir, "settings.json"),
    authPath: path.join(dataDir, "auth.json"),
    logsDir,
    providerLogsDir,
    providerEventLogPath: path.join(providerLogsDir, "events.log"),
    allowedOrigins: parseAllowedOrigins(process.env.BETTERC0DE_ALLOWED_ORIGINS),
    trustProxyHeaders: envFlag(process.env.BETTERC0DE_TRUST_PROXY),
    allowInsecureRemoteAccess: envFlag(
      process.env.BETTERC0DE_ALLOW_INSECURE_REMOTE_ACCESS
    ),
    runtimeHeapSnapshotsEnabled: envFlag(
      process.env.BETTERC0DE_ENABLE_HEAP_SNAPSHOTS
    ),
  }
}

/** Candidate ports tried in order at bind time. `0` = OS-assigned. */
export function candidatePorts(basePort: number): number[] {
  const ports = [basePort]
  for (let i = 1; i <= PORT_FALLBACK_COUNT; i++) ports.push(basePort + i)
  ports.push(0) // OS-assigned fallback
  return ports
}

function envFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "")
}
