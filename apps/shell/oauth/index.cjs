/**
 * OAuth helper — generic PKCE + state + local-callback-server plumbing
 * shared by every provider-specific OAuth file in this directory.
 *
 * Provider files (e.g. `codex.cjs`) export an object of shape:
 *   {
 *     id: "openai",                          // matches catalog provider id
 *     start: async () => Promise<{
 *       url: string,                         // authorize URL (browser)
 *       instructions: string,
 *       wait: () => Promise<Credential>,     // resolves on callback
 *     }>
 *   }
 *
 * The `start()` function spawns the local listener (if it needs one) and
 * the IPC handler does:
 *   1. Call `start()` to get { url, wait }.
 *   2. Open `url` in the user's browser via `shell.openExternal`.
 *   3. Await `wait()` and persist the resulting credential via the backend's
 *      auth store (HTTP PATCH against /api/v1/providers/<id>/credential).
 *
 * Why a local server (port chosen per-provider, default 1455 like Codex)?
 *   - The OAuth redirect must land somewhere reachable from the user's
 *     browser. `localhost:<port>` is the only origin we can guarantee
 *     across machines without a public callback domain.
 *   - The `state` parameter is verified server-side to defeat CSRF: a
 *     spoofed callback that doesn't match the in-flight `state` is
 *     rejected before it ever reaches the token-exchange step.
 */

const crypto = require("node:crypto")

/** Cryptographically-strong PKCE code verifier + S256 challenge. */
async function generatePkce() {
  // 43-char URL-safe random verifier — RFC 7636 says 43–128 chars.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.randomBytes(43)
  const verifier = Array.from(bytes).map((b) => chars[b % chars.length]).join("")
  const hash = crypto.createHash("sha256").update(verifier).digest()
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

/** 256-bit anti-CSRF nonce, base64url-encoded. */
function generateState() {
  return base64UrlEncode(crypto.randomBytes(32))
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Stand up a one-shot HTTP server on `port` that closes after the OAuth
 * callback fires. A second flow on an occupied port fails without retaining
 * a callback timer or an unobserved rejection.
 *
 * Returns { redirectUri, wait } — `wait` resolves with the URL search
 * params from the callback (or rejects on timeout / state mismatch).
 */
function startCallbackServer({ port, expectedState, timeoutMs = 5 * 60_000, successHtml, errorHtml }) {
  const http = require("node:http")
  let server
  let resolveCb
  let rejectCb
  const result = new Promise((resolve, reject) => {
    resolveCb = resolve
    rejectCb = reject
  })
  // A bind failure or early callback can happen before the caller gets wait().
  // Observe the promise now while preserving its rejection for that caller.
  result.catch(() => {})
  let settled = false

  function finish(error, value) {
    if (settled) return
    settled = true
    clearTimeout(onTimeout)
    if (error) rejectCb(error)
    else resolveCb(value)
    try { server?.close() } catch { /* best-effort */ }
  }

  const onTimeout = setTimeout(() => {
    finish(new Error("OAuth callback timeout — authorisation took too long"))
    server?.closeAllConnections?.()
  }, timeoutMs)
  if (onTimeout.unref) onTimeout.unref()

  server = http.createServer((req, res) => {
    let parsed
    try {
      parsed = new URL(req.url || "/", `http://127.0.0.1:${port}`)
    } catch {
      res.writeHead(400); res.end("bad request"); return
    }

    if (parsed.pathname === "/auth/callback") {
      const state = parsed.searchParams.get("state")
      const code = parsed.searchParams.get("code")
      const err = parsed.searchParams.get("error")

      // CSRF: callback's `state` MUST equal what we generated. Failure
      // means either an attacker injected a bogus callback into the user's
      // browser or two flows collided — refuse either way.
      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(typeof errorHtml === "function" ? errorHtml("Invalid state") : DEFAULT_ERROR_HTML("Invalid state"))
        finish(new Error("Invalid state — potential CSRF"))
        return
      }

      if (err) {
        const msg = parsed.searchParams.get("error_description") || err
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(typeof errorHtml === "function" ? errorHtml(msg) : DEFAULT_ERROR_HTML(msg))
        finish(new Error(msg))
        return
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(typeof errorHtml === "function" ? errorHtml("Missing code") : DEFAULT_ERROR_HTML("Missing code"))
        finish(new Error("Missing authorisation code"))
        return
      }

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(successHtml || DEFAULT_SUCCESS_HTML)
      finish(null, { code, state })
      return
    }

    res.writeHead(404); res.end("not found")
  })

  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      finish(error)
      reject(error)
    })
    server.listen(port, "127.0.0.1", () => {
      resolve({
        redirectUri: `http://127.0.0.1:${port}/auth/callback`,
        wait: () => result,
        close: () => {
          finish(new Error("OAuth callback cancelled"))
          server.closeAllConnections?.()
        },
      })
    })
  })
}

const DEFAULT_SUCCESS_HTML = `<!doctype html><html><body style="font-family:system-ui;background:#131010;color:#f1ecec;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h1>Authorisation successful</h1><p>You can close this window and return to BetterC0de.</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>`

const DEFAULT_ERROR_HTML = (msg) => `<!doctype html><html><body style="font-family:system-ui;background:#131010;color:#f1ecec;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h1 style="color:#fc533a">Authorisation failed</h1><pre style="color:#ff917b;background:#3c140d;padding:1rem;border-radius:.5rem">${escapeHtml(String(msg))}</pre></div></body></html>`

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

module.exports = {
  generatePkce,
  generateState,
  base64UrlEncode,
  startCallbackServer,
}
