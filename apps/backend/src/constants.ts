/**
 * Shared named constants for the Node backend.
 *
 * Grouped by domain so call-sites can import only the slice they care about.
 * Rule: every magic number or URL that appears in more than one file — or that
 * represents a tunable threshold — lives here. Values are intentionally kept
 * identical to the originals; this is a readability refactor, not a behaviour
 * change.
 */

// ── LM Studio ───────────────────────────────────────────────────────────────

/** Default base URL for the local LM Studio inference server. */
export const LM_STUDIO_BASE_URL = "http://localhost:1234/v1";

/** All commonly-used LM Studio base URLs. The server defaults to 1234 but
 *  some installs use 1111; users may bind 127.0.0.1 instead of localhost.
 *  Probe these in order — first one to answer wins. */
export const LM_STUDIO_BASE_CANDIDATES = [
  "http://127.0.0.1:1234/v1",
  "http://localhost:1234/v1",
  "http://127.0.0.1:1111/v1",
  "http://localhost:1111/v1",
] as const;

/** Probe LM Studio candidate URLs in priority order. Returns the first base
 *  URL that responds 2xx to GET /models, or null if none answer within the
 *  per-candidate timeout. */
export async function probeLmStudioBaseUrl(timeoutMs = 1500): Promise<string | null> {
  for (const base of LM_STUDIO_BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}/models`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return base;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ── WebSocket ───────────────────────────────────────────────────────────────

/** Time a freshly-connected WebSocket client has to complete the auth
 *  handshake before the server closes the socket. */
export const WS_AUTH_TIMEOUT_MS = 5_000;

/** Application-level close code sent when authentication fails or times out. */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/**
 * Upper bound on sockets that were upgraded without upgrade-time credentials
 * and are still waiting for their in-band `auth` frame. Each one holds a
 * connection for up to `WS_AUTH_TIMEOUT_MS`; without a cap anyone who can
 * reach the port could pin an unbounded number of them.
 */
export const WS_MAX_PENDING_AUTH_SOCKETS = 64;

// ── HTTP / Server ───────────────────────────────────────────────────────────

/** Preferred port for the local HTTP/WS sidecar. */
export const DEFAULT_PORT = 3773;

/** How many fallback ports to try after `DEFAULT_PORT` before falling back to
 *  OS-assigned (0). The bind sequence is: base, base+1, base+2, 0. */
export const PORT_FALLBACK_COUNT = 2;

// ── Shutdown ───────────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for in-flight streaming turns to settle after
 *  aborting them during graceful shutdown. */
export const SHUTDOWN_INFLIGHT_DRAIN_MS = 5_000;

/** Hard ceiling (ms) for the entire graceful shutdown sequence. If the
 *  sequence hasn't completed within this budget, `process.exit(1)` fires. */
export const SHUTDOWN_HARD_TIMEOUT_MS = 10_000;
