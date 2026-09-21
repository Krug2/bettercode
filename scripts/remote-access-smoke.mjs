import { access, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import Database from "better-sqlite3"
import { WebSocket } from "ws"

const root = path.resolve(import.meta.dirname, "..")
const backendModulePath = path.join(
  root,
  "apps",
  "backend",
  "dist",
  "inProcess.js"
)
const webRoot = path.join(root, "apps", "ui", "dist")
const indexPath = path.join(webRoot, "index.html")
const dataDir = await mkdtemp(
  path.join(os.tmpdir(), "betterc0de-remote-smoke-")
)
const workspaceDir = path.join(dataDir, "workspace")
process.env.BETTERC0DE_HOME = dataDir
process.env.BETTERC0DE_DATA_DIR = dataDir
process.env.BETTERC0DE_PROVIDER_SESSION_REAPER = "0"

let backend = null
let startNodeBackend = null

try {
  await Promise.all([access(backendModulePath), access(indexPath)])
  seedIsolatedDatabase(dataDir)
  await mkdir(workspaceDir)
  const backendModule = await import(pathToFileURL(backendModulePath).href)
  startNodeBackend =
    backendModule.startNodeBackend ?? backendModule.default?.startNodeBackend
  assert(
    typeof startNodeBackend === "function",
    "built backend exports startNodeBackend"
  )

  backend = await startBackend(dataDir)
  const initialBaseUrl = `http://127.0.0.1:${backend.port}`
  const initialBootstrap = await requestJson(
    `${initialBaseUrl}/api/v1/remote/bootstrap`,
    {},
    200
  )
  assert(initialBootstrap.enabled === false, "remote access starts disabled")
  assert(
    initialBootstrap.authenticated === false,
    "bootstrap does not expose the process bearer"
  )

  await requestJson(
    `${initialBaseUrl}/api/v1/settings`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${backend.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patch: { remote_access_enabled: true } }),
    },
    200
  )

  // Register an isolated workspace through the same thread write path as the
  // renderer. Shell capabilities must still reject arbitrary filesystem roots.
  const createdAt = new Date().toISOString()
  const fixtureHeaders = {
    Authorization: `Bearer ${backend.token}`,
    "Content-Type": "application/json",
  }
  await requestJson(
    `${initialBaseUrl}/api/v1/threads/remote-smoke-thread`,
    {
      method: "PATCH",
      headers: fixtureHeaders,
      body: JSON.stringify({
        title: "Remote smoke",
        projectName: "Smoke",
        projectPath: workspaceDir,
        createdAt,
        updatedAt: createdAt,
      }),
    },
    204
  )
  await requestJson(
    `${initialBaseUrl}/api/v1/threads/remote-smoke-thread/messages`,
    {
      method: "POST",
      headers: fixtureHeaders,
      body: JSON.stringify({
        id: "remote-smoke-message",
        role: "user",
        content: "Persist this message",
        modelId: "gpt-6-astra",
        createdAt,
      }),
    },
    204
  )

  await backend.stop()
  backend = null

  backend = await startBackend(dataDir)
  const baseUrl = `http://127.0.0.1:${backend.port}`
  const ownerHeaders = {
    Authorization: `Bearer ${backend.token}`,
  }
  const restoredThreads = await requestJson(
    `${baseUrl}/api/v1/threads`,
    { headers: ownerHeaders },
    200
  )
  assert(
    restoredThreads.some(
      (thread) =>
        thread.id === "remote-smoke-thread" &&
        thread.projectPath === workspaceDir
    ),
    "chat workspace survives restart"
  )
  const restoredMessages = await requestJson(
    `${baseUrl}/api/v1/threads/remote-smoke-thread/messages`,
    { headers: ownerHeaders },
    200
  )
  assert(
    restoredMessages.some(
      (message) =>
        message.id === "remote-smoke-message" &&
        message.content === "Persist this message" &&
        message.modelId === "gpt-6-astra"
    ),
    "message and selected model survive restart"
  )
  const loadedSettings = await requestJson(
    `${baseUrl}/api/v1/settings`,
    { headers: ownerHeaders },
    200
  )

  const bootstrap = await requestJson(
    `${baseUrl}/api/v1/remote/bootstrap`,
    {},
    200
  )
  assert(
    bootstrap.enabled === true,
    `remote access survives restart (${JSON.stringify({ bootstrap, setting: loadedSettings.remote_access_enabled })})`
  )
  assert(bootstrap.authenticated === false, "new browsers remain locked")

  const status = await requestJson(
    `${baseUrl}/api/v1/remote/status`,
    { headers: ownerHeaders },
    200
  )
  assert(status.host === "0.0.0.0", "enabled backend listens on the network")
  assert(status.listeningOnNetwork === true, "network listener is reported")
  assert(
    status.endpoints.some(
      (endpoint) =>
        endpoint.httpBaseUrl === baseUrl && endpoint.reachability === "loopback"
    ),
    "loopback endpoint is advertised"
  )

  const pageResponse = await fetchWithDeadline(`${baseUrl}/`)
  expectStatus(pageResponse, 200, "remote app shell")
  const html = await pageResponse.text()
  assert(
    html.includes("window.__BETTERC0DE__") && html.includes('"remote_http"'),
    "app shell receives same-origin remote runtime configuration"
  )
  assert(
    pageResponse.headers.get("cache-control") === "no-store",
    "runtime-configured app shell is not cached"
  )

  const assetPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
  assert(
    typeof assetPath === "string",
    "app shell references a JavaScript asset"
  )
  const assetResponse = await fetchWithDeadline(new URL(assetPath, baseUrl))
  const assetBytes = await assetResponse.arrayBuffer()
  expectStatus(assetResponse, 200, "remote JavaScript asset")
  assert(
    assetResponse.headers.get("content-type")?.includes("javascript") === true,
    "JavaScript asset has the correct content type"
  )
  assert(
    assetResponse.headers.get("cache-control")?.includes("immutable") === true,
    "fingerprinted assets are immutable"
  )
  assert(assetBytes.byteLength > 0, "remote JavaScript asset is not empty")
  expectStatus(
    await fetchWithDeadline(`${baseUrl}/assets/does-not-exist.js`),
    404,
    "missing remote asset"
  )
  const spaResponse = await fetchWithDeadline(`${baseUrl}/settings`)
  expectStatus(spaResponse, 200, "remote SPA route")
  assert(
    (await spaResponse.text()).includes("window.__BETTERC0DE__"),
    "SPA navigation receives runtime configuration"
  )

  expectStatus(
    await fetchWithDeadline(`${baseUrl}/api/v1/projects`),
    401,
    "unpaired protected API request"
  )

  const pairing = await requestJson(
    `${baseUrl}/api/v1/remote/pairing-links`,
    {
      method: "POST",
      headers: { ...ownerHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Remote smoke device", ttlMinutes: 5 }),
    },
    200
  )
  assert(
    typeof pairing.credential === "string" && pairing.credential.length === 14,
    "owner receives a short pairing code"
  )
  assert(pairing.links.length > 0, "owner receives pairing links")
  for (const link of pairing.links) {
    const parsed = new URL(link.url)
    assert(
      parsed.search === "",
      "pairing secret is absent from the query string"
    )
    assert(
      new URLSearchParams(parsed.hash.slice(1)).get("token") ===
        pairing.credential,
      "pairing secret is confined to the URL fragment"
    )
  }

  await requestJson(
    `${baseUrl}/api/v1/remote/pair`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "AAAA-BBBB-CCCC" }),
    },
    401
  )

  const pairResponse = await fetchWithDeadline(`${baseUrl}/api/v1/remote/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credential: pairing.credential,
      label: "Remote smoke browser",
    }),
  })
  expectStatus(pairResponse, 200, "valid one-time pairing")
  const paired = await pairResponse.json()
  assert(
    paired.authentication === "remote" &&
      typeof paired.session?.id === "string",
    "pairing creates a remote session"
  )
  const setCookie = pairResponse.headers.get("set-cookie") ?? ""
  assert(
    setCookie.includes("betterc0de_remote_session="),
    "pairing sets a session cookie"
  )
  assert(/HttpOnly/i.test(setCookie), "remote session cookie is HttpOnly")
  assert(
    /SameSite=Strict/i.test(setCookie),
    "remote session cookie is SameSite=Strict"
  )
  const cookie = setCookie.split(";", 1)[0]

  await requestJson(
    `${baseUrl}/api/v1/remote/pair`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: pairing.credential }),
    },
    401
  )

  const remoteHeaders = { Cookie: cookie, Origin: baseUrl }
  const pairedBootstrapResponse = await fetchWithDeadline(
    `${baseUrl}/api/v1/remote/bootstrap`,
    { headers: remoteHeaders }
  )
  expectStatus(pairedBootstrapResponse, 200, "paired bootstrap")
  assert(
    pairedBootstrapResponse.headers.get("access-control-allow-origin") ===
      baseUrl &&
      pairedBootstrapResponse.headers.get(
        "access-control-allow-credentials"
      ) === "true",
    "same-origin browser requests receive credentialed CORS headers"
  )
  const pairedBootstrap = await pairedBootstrapResponse.json()
  assert(
    pairedBootstrap.authenticated === true &&
      pairedBootstrap.session?.id === paired.session.id,
    "HttpOnly cookie restores the paired session"
  )

  await requestJson(
    `${baseUrl}/api/v1/settings`,
    { headers: remoteHeaders },
    200
  )
  await requestJson(
    `${baseUrl}/api/v1/projects`,
    { headers: remoteHeaders },
    200
  )
  await requestJson(
    `${baseUrl}/api/v1/threads`,
    { headers: remoteHeaders },
    200
  )

  const mobilePairing = await requestJson(
    `${baseUrl}/api/v1/remote/pairing-links`,
    {
      method: "POST",
      headers: { ...ownerHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Remote smoke mobile" }),
    },
    200
  )
  const mobilePairResponse = await fetchWithDeadline(
    `${baseUrl}/api/v1/remote/mobile/pair`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credential: mobilePairing.credential,
        label: "Remote smoke phone",
      }),
    }
  )
  expectStatus(mobilePairResponse, 200, "native mobile pairing")
  assert(
    mobilePairResponse.headers.get("cache-control") === "no-store",
    "native pairing credentials are never cached"
  )
  assert(
    mobilePairResponse.headers.get("set-cookie") === null,
    "native pairing does not rely on browser cookies"
  )
  const mobilePaired = await mobilePairResponse.json()
  assert(
    mobilePaired.tokenType === "Bearer" &&
      typeof mobilePaired.sessionToken === "string" &&
      mobilePaired.sessionToken.startsWith("bc_remote_"),
    "native pairing returns a revocable bearer session"
  )
  const mobileHeaders = {
    Authorization: `Bearer ${mobilePaired.sessionToken}`,
  }
  const mobileBootstrap = await requestJson(
    `${baseUrl}/api/v1/remote/bootstrap`,
    { headers: mobileHeaders },
    200
  )
  assert(
    mobileBootstrap.authenticated === true &&
      mobileBootstrap.environmentId === mobilePaired.environmentId,
    "native bearer restores the paired desktop environment"
  )
  await requestJson(
    `${baseUrl}/api/v1/threads`,
    { headers: mobileHeaders },
    200
  )
  await assertRemoteWebSocketToken(baseUrl, mobilePaired.sessionToken)

  // A paired device gets no terminal until the desktop owner grants it:
  // the capability endpoint must refuse with the dedicated code first.
  const refusedGrant = await requestJson(
    `${baseUrl}/api/v1/shell/capability`,
    {
      method: "POST",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "run",
        command: "echo remote-smoke",
        cwd: workspaceDir,
      }),
    },
    403
  )
  assert(
    refusedGrant?.code === "remote_terminal_disabled",
    `remote terminal must be refused until granted; got ${JSON.stringify(refusedGrant)}`
  )
  // Only the desktop bearer may flip the grant; the paired session cannot.
  await requestJson(
    `${baseUrl}/api/v1/settings`,
    {
      method: "PATCH",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { remote_access_allow_terminal: true } }),
    },
    403
  )
  await requestJson(
    `${baseUrl}/api/v1/settings`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${backend.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patch: { remote_access_allow_terminal: true } }),
    },
    200
  )
  const shellGrant = await requestJson(
    `${baseUrl}/api/v1/shell/capability`,
    {
      method: "POST",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "run",
        command: "echo remote-smoke",
        cwd: workspaceDir,
      }),
    },
    200
  )
  const shellResult = await requestJson(
    `${baseUrl}/api/v1/shell/run`,
    {
      method: "POST",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "echo remote-smoke",
        cwd: workspaceDir,
        humanOrigin: true,
        permissionLevel: "bypass",
        humanCapability: shellGrant.capability,
      }),
    },
    200
  )
  assert(
    shellResult.success === true &&
      String(shellResult.combined).includes("remote-smoke"),
    "paired browser can execute an operation-bound terminal command"
  )
  await assertRemoteWebSocket(baseUrl, cookie)

  await requestJson(
    `${baseUrl}/api/v1/remote/pairing-links`,
    {
      method: "POST",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: "{}",
    },
    403
  )
  await requestJson(
    `${baseUrl}/api/v1/settings`,
    {
      method: "PATCH",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { remote_access_enabled: false } }),
    },
    403
  )

  const sessions = await requestJson(
    `${baseUrl}/api/v1/remote/sessions`,
    { headers: ownerHeaders },
    200
  )
  assert(
    sessions.sessions.some((session) => session.id === paired.session.id),
    "desktop owner can inspect paired sessions"
  )
  assert(
    sessions.sessions.some((session) => session.id === mobilePaired.session.id),
    "desktop owner can inspect native mobile sessions"
  )

  const revoked = await requestJson(
    `${baseUrl}/api/v1/remote/sessions/${encodeURIComponent(paired.session.id)}`,
    { method: "DELETE", headers: ownerHeaders },
    200
  )
  assert(revoked.revoked === true, "desktop owner can revoke a device")
  const revokedBootstrap = await requestJson(
    `${baseUrl}/api/v1/remote/bootstrap`,
    { headers: { Cookie: cookie } },
    200
  )
  assert(
    revokedBootstrap.authenticated === false,
    "revocation takes effect immediately"
  )
  expectStatus(
    await fetchWithDeadline(`${baseUrl}/api/v1/projects`, { headers: { Cookie: cookie } }),
    401,
    "revoked protected API request"
  )

  const logoutPairing = await requestJson(
    `${baseUrl}/api/v1/remote/pairing-links`,
    {
      method: "POST",
      headers: { ...ownerHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Remote logout device" }),
    },
    200
  )
  const logoutPairResponse = await fetchWithDeadline(`${baseUrl}/api/v1/remote/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: logoutPairing.credential }),
  })
  expectStatus(logoutPairResponse, 200, "logout pairing")
  const logoutCookie = (
    logoutPairResponse.headers.get("set-cookie") ?? ""
  ).split(";", 1)[0]
  const logout = await requestJson(
    `${baseUrl}/api/v1/remote/logout`,
    { method: "POST", headers: { Cookie: logoutCookie } },
    200
  )
  assert(logout.loggedOut === true, "remote device can sign itself out")
  const loggedOutBootstrap = await requestJson(
    `${baseUrl}/api/v1/remote/bootstrap`,
    { headers: { Cookie: logoutCookie } },
    200
  )
  assert(
    loggedOutBootstrap.authenticated === false,
    "logout revokes the session"
  )

  process.stdout.write(
    `Remote access smoke passed on port ${backend.port}: chat and model persistence across restart, static app, browser and native pairing, cookie and bearer APIs, terminal capability, WebSocket, replay rejection, owner boundary, revocation, and logout.\n`
  )
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  )
  process.exitCode = 1
} finally {
  if (backend) await backend.stop()
  await rm(dataDir, { recursive: true, force: true })
}

function assert(condition, message) {
  if (!condition) throw new Error(`Remote smoke assertion failed: ${message}`)
}

function seedIsolatedDatabase(profileDir) {
  const database = new Database(path.join(profileDir, "betterc0de.db"))
  try {
    database.exec(
      "CREATE TABLE remote_smoke_seed (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)"
    )
  } finally {
    database.close()
  }
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned HTTP ${response.status}; expected HTTP ${expected}`
    )
  }
}

async function requestJson(url, init, expectedStatus) {
  const response = await fetchWithDeadline(url, init)
  const text = await response.text()
  expectStatus(response, expectedStatus, `${init.method ?? "GET"} ${url}`)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `Expected JSON from ${url}; received: ${text.slice(0, 300)}`
    )
  }
}

async function startBackend(profileDir) {
  return startNodeBackend({
    dataDir: profileDir,
    preferredPort: 0,
    webRoot,
  })
}

function assertRemoteWebSocket(baseUrl, cookie) {
  const wsUrl = new URL(baseUrl)
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
  wsUrl.pathname = "/ws"

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, {
      origin: baseUrl,
      headers: { Cookie: cookie },
    })
    const timer = setTimeout(() => {
      socket.terminate()
      reject(
        new Error("remote WebSocket did not authenticate within 5 seconds")
      )
    }, 5_000)
    const finish = (error) => {
      clearTimeout(timer)
      socket.removeAllListeners()
      if (error) reject(error)
      else resolve()
    }
    socket.on("message", (data) => {
      try {
        const frame = JSON.parse(data.toString("utf8"))
        if (frame?.type === "auth_ok") {
          socket.close()
          finish()
        }
      } catch {
        // Ignore non-JSON frames while waiting for the authentication contract.
      }
    })
    socket.once("error", (error) => finish(error))
    socket.once("close", () =>
      finish(new Error("remote WebSocket closed before authentication"))
    )
  })
}

function assertRemoteWebSocketToken(baseUrl, token) {
  const wsUrl = new URL(baseUrl)
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
  wsUrl.pathname = "/ws"

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { origin: baseUrl })
    const timer = setTimeout(() => {
      socket.terminate()
      reject(
        new Error("mobile WebSocket did not authenticate within 5 seconds")
      )
    }, 5_000)
    const finish = (error) => {
      clearTimeout(timer)
      socket.removeAllListeners()
      if (error) reject(error)
      else resolve()
    }
    socket.once("open", () => {
      socket.send(JSON.stringify({ type: "auth", token }))
    })
    socket.on("message", (data) => {
      try {
        const frame = JSON.parse(data.toString("utf8"))
        if (frame?.type === "auth_ok") {
          socket.close()
          finish()
        }
      } catch {
        // Ignore non-JSON frames while waiting for the authentication contract.
      }
    })
    socket.once("error", (error) => finish(error))
    socket.once("close", () =>
      finish(new Error("mobile WebSocket closed before authentication"))
    )
  })
}

function fetchWithDeadline(url, init = {}) {
  return globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(5_000) })
}
