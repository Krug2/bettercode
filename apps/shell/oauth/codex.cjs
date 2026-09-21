/**
 * ChatGPT Pro/Plus OAuth flow for the `openai` provider.
 *
 * Standalone BetterC0de OAuth helper. The IPC layer calls `start()` directly,
 * without any plugin-host dependency.
 *
 * Threat model:
 *   - PKCE S256 (no client secret leaks if the binary is dumped).
 *   - State nonce verified server-side in `oauth/index.cjs::startCallbackServer`.
 *   - Loopback callback (127.0.0.1) — the redirect URI never leaves the
 *     user's machine.
 *   - `client_id` is BetterC0de's published Codex client id, reused with
 *     attribution; OpenAI's flow validates redirect URIs against the
 *     client registration so we cannot impersonate a different IDE.
 */

const { generatePkce, generateState, startCallbackServer } = require("./index.cjs")
const { fetchJson } = require("../shared/fetch-json.cjs")

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const OAUTH_PORT = 1455

function buildAuthorizeUrl(redirectUri, pkce, state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "betterc0de",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

async function exchangeCodeForTokens(code, redirectUri, pkce) {
  const tokens = await fetchJson(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)
    || typeof tokens.access_token !== "string" || !tokens.access_token.trim()
    || typeof tokens.refresh_token !== "string" || !tokens.refresh_token.trim()
    || tokens.access_token.length > 16 * 1024 || tokens.refresh_token.length > 16 * 1024
    || (tokens.id_token !== undefined && typeof tokens.id_token !== "string")
    || (tokens.expires_in !== undefined && (typeof tokens.expires_in !== "number"
      || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0
      || !Number.isSafeInteger(Math.ceil(Date.now() + tokens.expires_in * 1000))))) {
    throw new Error("Token exchange returned an invalid credential")
  }
  return tokens
}

function parseJwtClaims(token) {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

function extractAccountId(tokens) {
  const fromIdToken = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined
  if (fromIdToken) {
    return (
      fromIdToken.chatgpt_account_id
      || fromIdToken["https://api.openai.com/auth"]?.chatgpt_account_id
      || fromIdToken.organizations?.[0]?.id
    )
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    if (claims) {
      return (
        claims.chatgpt_account_id
        || claims["https://api.openai.com/auth"]?.chatgpt_account_id
        || claims.organizations?.[0]?.id
      )
    }
  }
  return undefined
}

/**
 * Begin a Codex OAuth flow. Returns `{ url, instructions, wait }`.
 * Caller opens `url` in the browser, then awaits `wait()` to get the
 * resulting OAuth credential (already in the shape `auth/store.ts`
 * expects).
 */
async function start() {
  const pkce = await generatePkce()
  const state = generateState()
  const cb = await startCallbackServer({
    port: OAUTH_PORT,
    expectedState: state,
  })
  const url = buildAuthorizeUrl(cb.redirectUri, pkce, state)

  return {
    url,
    close: () => cb.close(),
    instructions: "Sign in to ChatGPT in the browser tab that just opened. The window will close itself when authorisation is complete.",
    /** Resolves with the `Credential` to persist via the backend. */
    wait: async () => {
      try {
        const { code } = await cb.wait()
        const tokens = await exchangeCodeForTokens(code, cb.redirectUri, pkce)
        const expires = Date.now() + ((tokens.expires_in ?? 3600) * 1000)
        return {
          type: "oauth",
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          expires,
          accountId: extractAccountId(tokens),
        }
      } finally {
        cb.close()
      }
    },
  }
}

module.exports = {
  id: "openai",
  handler: "codex-oauth",
  start,
}
