import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import WebSocket from "ws"
import { afterEach, expect, it, vi } from "vitest"
import { startRelay } from "../../apps/relay/src/server"
import { openDatabase } from "../../apps/backend/src/persistence/db"
import { runMigrations } from "../../apps/backend/src/persistence/migrations"
import { RemoteAccessService } from "../../apps/backend/src/remote/service"
import { DeviceManager } from "../../apps/backend/src/remote/relay/manager"
import { buildApp } from "../../apps/backend/src/http/router"
import { defaultSettings } from "../../packages/schema/src/settings"
import { routingTestServices } from "../../apps/backend/src/testUtils/routing-services"
import { readBody, requestDevice } from "../../apps/backend/src/remote/relay/http-channel"
import { allowedDevicePath } from "../../apps/backend/src/remote/relay/gateway"
import { WsHub } from "../../apps/backend/src/ws/server"
import type { AppState } from "../../apps/backend/src/appState"
import type { ServerConfig } from "../../apps/backend/src/config"

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function setupDevice(label: string, relay: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bettercode-device-test-"))
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  const db = openDatabase(path.join(directory, "test.sqlite"))
  runMigrations(db)
  cleanup.push(() => { db.close() })
  const settings = { ...defaultSettings(), remote_relay_enabled: true, remote_relay_url: relay, remote_device_label: label }
  const access = new RemoteAccessService(db, { isEnabled: () => settings.remote_relay_enabled })
  cleanup.push(() => access.close())
  const config = { authToken: "local-only-secret", host: "127.0.0.1", port: 1, dataDir: directory } as ServerConfig
  const state = {
    ...routingTestServices(), config, db, remoteAccess: access,
    settings: { get: () => settings, getPublic: () => settings },
    threads: { persistUserMessageForTurn: vi.fn() }, providerRegistry: { all: () => [] },
  } as unknown as AppState
  const app = buildApp(config, state)
  const requests: Request[] = []
  const server = http.createServer()
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const hub = new WsHub(config.authToken!, {
    authenticateToken: token => {
      const session = access.authenticate(token)
      return session ? { kind: "remote", sessionId: session.id, accessLevel: session.accessLevel, expiresAt: Date.parse(session.expiresAt) } : null
    },
    revalidateRemoteSession: principal => access.isSessionActive(principal.sessionId),
    subscribeToRemoteSessionRevocations: listener => access.subscribeToSessionRevocations(listener),
  })
  hub.attach(server)
  cleanup.push(() => hub.close())
  const devices = new DeviceManager({ dataDir: directory, access, settings: () => settings, localPort: () => (server.address() as { port: number }).port })
  cleanup.push(() => devices.close())
  const webRoot = path.join(directory, "client")
  fs.mkdirSync(webRoot)
  fs.writeFileSync(path.join(webRoot, "index.html"), "<html><head></head><body>trusted client</body></html>")
  devices.start(request => { requests.push(request); return app.fetch(request) }, webRoot)
  await vi.waitFor(async () => expect((await devices.status()).state).toBe("online"), { timeout: 10_000 })
  return { devices, access, requests, settings, hub }
}

it("pairs two devices, enforces existing remote restrictions, reconnects, and revokes", async () => {
  const relay = await startRelay({ port: 0 })
  cleanup.push(() => relay.close())
  const host = await setupDevice("host", relay.url)
  const viewer = await setupDevice("viewer", relay.url)
  const invitation = await host.devices.invite()
  const linking = await viewer.devices.link(invitation.code)
  await vi.waitFor(async () => expect((await host.devices.status()).pending).toHaveLength(1), { timeout: 10_000 })
  const pending = (await host.devices.status()).pending[0]!
  expect(pending.code).toBe(linking.code)
  expect(host.access.listSessions()).toHaveLength(0)
  host.devices.approve(pending.id, { accessLevel: "read_only", allowTerminal: false })
  await vi.waitFor(async () => expect((await viewer.devices.status()).links[0]?.status).toBe("linked"), { timeout: 10_000 })
  const id = (await host.devices.status()).id
  let connection = await viewer.devices.connect(id)
  const request = async (path: string, method = "GET") => {
    const stream = requestDevice(connection.session, path, method)
    let status = 0
    stream.once("response", headers => { status = Number(headers[":status"]) })
    stream.end()
    const body = JSON.parse((await readBody(stream, 16_384)).toString())
    return { status, body }
  }
  expect(await request("/api/v1/remote/bootstrap")).toMatchObject({ status: 200, body: { authentication: "remote", environmentId: host.access.environmentId() } })
  expect(host.requests[0]?.headers.get("authorization")).toMatch(/^Bearer bc_remote_/)
  expect(await request("/api/v1/threads", "POST")).toMatchObject({ status: 403 })
  expect(await request("/api/v1/runtime/debug-info")).toMatchObject({ status: 403 })
  expect(await request("/api/v1/shell/run", "POST")).toMatchObject({ status: 403 })
  expect(await request("/api/v1/devices")).toMatchObject({ status: 403 })
  connection.session.destroy()
  connection = await viewer.devices.connect(id)
  expect(await request("/api/v1/remote/bootstrap")).toMatchObject({ status: 200 })
  const closed = new Promise<void>(resolve => connection.session.once("close", resolve))
  await host.devices.revoke(pending.peerId)
  await closed
  await expect(viewer.devices.connect(id)).rejects.toThrow("expired or was revoked")
  expect(host.access.listSessions()).toHaveLength(0)
}, 30_000)

it("rejects proxy escapes and encoded management routes", () => {
  for (const value of ["https://elsewhere/api/v1/threads", "//elsewhere/api/v1/threads", "/api/v1/../devices", "/api/v1/%64evices", "/api/v1/remote/pair", "/api/v1/a%2fb", "/api/v1/threads#ignored"])
    expect(allowedDevicePath(value), value).toBe(false)
  expect(allowedDevicePath("/api/v1/threads?limit=10")).toBe(true)
})

it("isolates the viewer origin and forwards authenticated live events", async () => {
  const relay = await startRelay({ port: 0 })
  cleanup.push(() => relay.close())
  const host = await setupDevice("host", relay.url)
  const viewer = await setupDevice("viewer", relay.url)
  const invitation = await host.devices.invite()
  await viewer.devices.link(invitation.code)
  await vi.waitFor(async () => expect((await host.devices.status()).pending).toHaveLength(1))
  host.devices.approve((await host.devices.status()).pending[0]!.id, { accessLevel: "full", allowTerminal: false })
  await vi.waitFor(async () => expect((await viewer.devices.status()).links[0]?.status).toBe("linked"))
  const opened = await viewer.devices.openView((await host.devices.status()).id)
  const url = new URL(opened.url)
  const token = new URLSearchParams(url.hash.slice(1)).get("token")!
  const fetchView = (route: string, headers: Record<string, string> = {}, body?: unknown) => new Promise<Response>((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: url.port, path: route,
      method: body ? "POST" : "GET", headers: { Host: url.host, Origin: url.origin, "Content-Type": "application/json", ...headers },
    }, response => {
      void readBody(response, 1024 * 1024).then(buffer => resolve(new Response(buffer, { status: response.statusCode,
        headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value as string])),
      })), reject)
    })
    request.on("error", reject)
    request.end(body ? JSON.stringify(body) : undefined)
  })
  expect((await fetchView("/api/v1/settings")).status).toBe(401)
  expect((await fetchView("/api/v1/remote/pair", { Origin: "https://untrusted.example" }, { credential: token })).status).toBe(403)
  const paired = await fetchView("/api/v1/remote/pair", {}, { credential: token })
  expect(paired.status).toBe(200)
  const cookie = paired.headers.get("set-cookie")!.split(";")[0]!
  expect(paired.headers.get("set-cookie")).toContain("HttpOnly")
  expect((await fetchView("/api/v1/remote/pair", {}, { credential: token })).status).toBe(403)
  expect((await fetchView("/api/v1/settings", { Cookie: cookie, Host: "localhost" })).status).toBe(403)
  const bootstrap = await fetchView("/api/v1/remote/bootstrap", { Cookie: cookie })
  expect(await bootstrap.json()).toMatchObject({ authentication: "remote", device: { id: opened.hostId, label: "host" } })
  const html = await (await fetchView("/")).text()
  expect(html).toContain('mode":"remote_http')
  expect(html).not.toContain("local-only-secret")
  const socket = new WebSocket(`ws://127.0.0.1:${url.port}/ws`, { headers: { Host: url.host, Origin: url.origin, Cookie: cookie } })
  cleanup.push(() => socket.terminate())
  const frames: Array<Record<string, unknown>> = []
  socket.on("message", data => frames.push(JSON.parse(data.toString())))
  socket.on("error", () => undefined)
  await vi.waitFor(() => expect(frames.some(frame => frame.type === "auth_ok")).toBe(true), { timeout: 10_000 })
  host.hub.broadcast({ channel: "test.device", data: { value: "remote event" } })
  await vi.waitFor(() => expect(frames.some(frame => frame.channel === "test.device")).toBe(true))
  const closed = new Promise<void>(resolve => socket.once("close", resolve))
  await host.devices.revoke((await viewer.devices.status()).id)
  await closed
}, 30_000)
