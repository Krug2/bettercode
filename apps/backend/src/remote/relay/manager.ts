import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { ClientHttp2Session, ServerHttp2Session } from "node:http2"
import { relayUrl } from "@betterc0de/remote-protocol"
import { z } from "zod"
import type { Settings } from "../../settings/schema"
import type { RemoteAccessService } from "../service"
import { connectRelay, registerRelayHost, type RelayRegistration } from "./connection"
import { acceptDeviceGateway } from "./gateway"
import { deviceJson, DeviceRequestError, openDeviceSession } from "./http-channel"
import { certificateId } from "./identity"
import { DevicePairing, deviceLabel, devicePermission, pairingCode, readInvitation } from "./pairing"
import { secureClient, secureServer } from "./tls-channel"
import { DeviceVault, type SavedHost } from "./vault"
import { createViewerBridge, type ViewerBridge } from "./viewer-bridge"

const hostInfo = z.object({
  version: z.literal(1), id: z.string(), label: deviceLabel, environmentId: z.string().uuid(),
  accessLevel: z.enum(["full", "read_only"]), allowTerminal: z.boolean(), expiresAt: z.string().datetime(),
})
export type ConnectedHost = { session: ClientHttp2Session; info: z.infer<typeof hostInfo> }
type LinkState = { id: string; hostId: string; label: string; code: string; status: "connecting" | "waiting" | "linked" | "error"; error?: string }
type RelaySettings = Pick<Settings, "remote_relay_enabled" | "remote_relay_url" | "remote_device_label">

export class DeviceManager {
  private vault?: DeviceVault
  private pairing?: DevicePairing
  private initializing?: Promise<DeviceVault>
  private registration?: RelayRegistration
  private hostAbort?: AbortController
  private retry?: NodeJS.Timeout
  private failures = 0
  private hostState = "disabled"
  private hostError: string | undefined
  private configuration = ""
  private fetch?: (request: Request) => Response | Promise<Response>
  private webRoot?: string
  private stopped = false
  private readonly incoming = new Set<ServerHttp2Session>()
  private readonly connections = new Map<string, ConnectedHost>()
  private readonly connecting = new Map<string, Promise<ConnectedHost>>()
  private readonly outgoing = new Map<string, AbortController>()
  private readonly cooldown = new Map<string, { until: number; failures: number; error: string }>()
  private readonly links = new Map<string, { state: LinkState; abort: AbortController }>()
  private readonly views = new Map<string, Promise<ViewerBridge>>()

  constructor(private readonly options: {
    dataDir: string; access: RemoteAccessService; settings(): RelaySettings; localPort(): number;
  }) {}

  label(): string { return this.options.settings().remote_device_label.trim() || os.hostname().slice(0, 80) }
  private address(): string { return this.options.settings().remote_relay_url.trim() || process.env.BETTERC0DE_RELAY_URL?.trim() || "" }

  private initialize(): Promise<DeviceVault> {
    this.initializing ??= Promise.resolve().then(async () => {
      const vault = new DeviceVault(path.join(this.options.dataDir, "devices.enc"))
      await vault.identity()
      this.vault = vault
      this.pairing = new DevicePairing(vault, this.options.access)
      return vault
    }).catch(error => { this.initializing = undefined; throw error })
    return this.initializing
  }

  start(fetch: (request: Request) => Response | Promise<Response>, webRoot?: string): void {
    this.fetch = fetch
    this.webRoot = webRoot
    this.reconcile()
  }

  reconcile(): void {
    if (!this.fetch || this.stopped) return
    const key = `${this.options.settings().remote_relay_enabled}:${this.address()}`
    if (key === this.configuration) return
    this.configuration = key
    this.hostAbort?.abort()
    this.registration?.close()
    clearTimeout(this.retry)
    this.pairing?.clear()
    for (const session of this.incoming) session.destroy()
    this.failures = 0
    this.hostError = undefined
    this.hostState = this.options.settings().remote_relay_enabled ? "connecting" : "disabled"
    if (!this.options.settings().remote_relay_enabled) return
    const abort = new AbortController()
    this.hostAbort = abort
    void this.register(abort)
  }

  private async register(abort: AbortController): Promise<void> {
    try {
      const address = relayUrl(this.address())
      const vault = await this.initialize()
      const identity = await vault.identity()
      abort.signal.throwIfAborted()
      this.hostState = "connecting"
      const registration = await registerRelayHost(address, identity, stream => {
        void secureServer(stream, identity).then(peer => {
          if (abort.signal.aborted) { peer.socket.destroy(); return }
          const session = acceptDeviceGateway(peer, {
            vault, pairing: this.pairing!, access: this.options.access,
            label: () => this.label(), enabled: () => !abort.signal.aborted && this.options.settings().remote_relay_enabled,
            localPort: this.options.localPort, fetch: request => this.fetch!(request),
          })
          this.incoming.add(session)
          session.once("close", () => this.incoming.delete(session))
        }).catch(() => stream.destroy())
      }, abort.signal)
      if (abort.signal.aborted) { registration.close(); return }
      this.registration = registration
      this.hostState = "online"
      this.hostError = undefined
      this.failures = 0
      await registration.closed
    } catch (error) {
      if (!abort.signal.aborted) this.hostError = error instanceof Error ? error.message.slice(0, 200) : "Relay connection failed"
    }
    if (abort.signal.aborted || this.stopped) return
    this.hostState = "reconnecting"
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5)) * (0.8 + Math.random() * 0.4)
    this.retry = setTimeout(() => { void this.register(abort) }, delay)
    this.retry.unref()
  }

  async status() {
    const vault = await this.initialize()
    const identity = await vault.identity()
    return {
      id: certificateId(identity.certificate), label: this.label(), persistent: vault.persistent,
      enabled: this.options.settings().remote_relay_enabled, relayUrl: this.address(), state: this.hostState, error: this.hostError,
      pending: this.pairing!.pending(), links: [...this.links.values()].map(link => ({ ...link.state })),
      grants: vault.grants().map(({ id, label, accessLevel, allowTerminal, expiresAt, sessionId }) => ({
        id, label, accessLevel, allowTerminal, expiresAt, active: this.options.access.isSessionActive(sessionId),
      })),
      hosts: vault.hosts().map(({ certificate: _certificate, ...host }) => ({
        ...host, state: this.connections.has(host.id) ? "online" : this.connecting.has(host.id) ? "connecting" : "offline",
        error: this.cooldown.get(host.id)?.error,
      })),
    }
  }

  async invite() {
    await this.initialize()
    if (this.hostState !== "online") throw new DeviceRequestError("Connect this computer to a relay first", 409)
    return this.pairing!.invite(this.address(), this.label())
  }

  approve(id: string, permission?: z.infer<typeof devicePermission>): void { this.pairing?.approve(id, permission) }

  async link(code: string): Promise<LinkState> {
    if (this.stopped) throw new Error("Device service is closed")
    const invitation = readInvitation(code)
    const vault = await this.initialize()
    const identity = await vault.identity()
    if (invitation.hostId === certificateId(identity.certificate)) throw new Error("Choose an invitation from another computer")
    for (const [id, link] of this.links) if (["linked", "error"].includes(link.state.status)) this.links.delete(id)
    if (this.links.size >= 4) throw new Error("Finish or cancel the current device links first")
    const state: LinkState = {
      id: randomUUID(), hostId: invitation.hostId, label: invitation.label, status: "connecting",
      code: pairingCode(invitation.hostId, certificateId(identity.certificate), invitation.token),
    }
    const abort = new AbortController()
    this.links.set(state.id, { state, abort })
    void (async () => {
      let session: ClientHttp2Session | undefined
      try {
        const raw = await connectRelay(invitation.relayUrl, invitation.hostId, abort.signal)
        const peer = await secureClient(raw, identity, invitation.certificate)
        session = openDeviceSession(peer)
        state.status = "waiting"
        const info = hostInfo.parse(await deviceJson(session, "/_device/pair", { token: invitation.token, label: this.label() }))
        abort.signal.throwIfAborted()
        if (info.id !== invitation.hostId) throw new Error("Device identity changed")
        vault.putHost({
          id: info.id, label: info.label, certificate: invitation.certificate, createdAt: new Date().toISOString(),
          environmentId: info.environmentId, relayUrl: invitation.relayUrl, accessLevel: info.accessLevel, expiresAt: info.expiresAt,
        })
        this.remember(info.id, { session, info })
        state.status = "linked"
      } catch (error) {
        session?.destroy()
        state.status = "error"
        state.error = abort.signal.aborted ? "Device linking cancelled" : error instanceof Error ? error.message.slice(0, 200) : "Device linking failed"
      }
    })()
    return { ...state }
  }

  cancelLink(id: string): void { this.links.get(id)?.abort.abort() }

  private remember(id: string, connection: ConnectedHost): void {
    this.connections.get(id)?.session.destroy()
    this.connections.set(id, connection)
    this.cooldown.delete(id)
    connection.session.once("close", () => {
      if (this.connections.get(id) === connection) this.connections.delete(id)
    })
  }

  async connect(id: string): Promise<ConnectedHost> {
    if (this.stopped) throw new Error("Device service is closed")
    const live = this.connections.get(id)
    if (live && !live.session.closed && !live.session.destroyed) return live
    const active = this.connecting.get(id)
    if (active) return active
    const cooldown = this.cooldown.get(id)
    if (cooldown && cooldown.until > Date.now()) throw new DeviceRequestError(cooldown.error, 503)
    const abort = new AbortController()
    this.outgoing.set(id, abort)
    const promise = this.dial(id, abort.signal).then(connection => {
      this.remember(id, connection)
      return connection
    }).catch(error => {
      const failures = (this.cooldown.get(id)?.failures ?? 0) + 1
      const message = error instanceof Error ? error.message.slice(0, 200) : "Device is offline"
      this.cooldown.set(id, { failures, until: Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), error: message })
      throw error
    }).finally(() => { this.connecting.delete(id); this.outgoing.delete(id) })
    this.connecting.set(id, promise)
    return promise
  }

  private async dial(id: string, signal: AbortSignal): Promise<ConnectedHost> {
    const vault = await this.initialize()
    const host = vault.hosts().find(host => host.id === id)
    if (!host) throw new DeviceRequestError("Device is not linked", 404)
    if (Date.parse(host.expiresAt) <= Date.now()) throw new DeviceRequestError("Link this device again to renew approval", 403)
    const raw = await connectRelay(host.relayUrl, id, signal)
    const peer = await secureClient(raw, await vault.identity(), host.certificate)
    const session = openDeviceSession(peer)
    try {
      const info = hostInfo.parse(await deviceJson(session, "/_device/connect", {}))
      signal.throwIfAborted()
      if (info.id !== id || info.environmentId !== host.environmentId) throw new Error("Device environment changed; link it again")
      return { session, info }
    } catch (error) { session.destroy(); throw error }
  }

  async savedHost(id: string): Promise<SavedHost> {
    const host = (await this.initialize()).hosts().find(host => host.id === id)
    if (!host) throw new DeviceRequestError("Device is not linked", 404)
    return host
  }

  async openView(id: string) {
    if (!this.webRoot) throw new DeviceRequestError("Build the app client before opening a device view", 503)
    const host = await this.savedHost(id)
    await this.connect(id)
    if (!this.views.has(id)) {
      const pending = createViewerBridge({
        host, webRoot: this.webRoot, connect: () => this.connect(id),
        connectionState: () => this.connections.has(id) ? "online" : this.connecting.has(id) ? "reconnecting" : "offline",
      }).then(async bridge => {
        if (this.stopped || !this.vault?.hosts().some(host => host.id === id)) { await bridge.close(); throw new Error("Device view was closed") }
        return bridge
      }).catch(error => { this.views.delete(id); throw error })
      this.views.set(id, pending)
    }
    const bridge = await this.views.get(id)!
    return { url: bridge.open(), hostId: id, label: host.label, environmentId: host.environmentId }
  }

  async forget(id: string): Promise<void> {
    const vault = await this.initialize()
    vault.removeHost(id)
    this.outgoing.get(id)?.abort()
    this.connections.get(id)?.session.destroy()
    this.cooldown.delete(id)
    const bridge = this.views.get(id)
    this.views.delete(id)
    if (bridge) await bridge.then(view => view.close()).catch(() => undefined)
  }

  async revoke(id: string): Promise<void> {
    const vault = await this.initialize()
    const grant = vault.grants().find(grant => grant.id === id)
    if (grant) await this.options.access.revokeSessionAndWait(grant.sessionId)
    vault.removeGrant(id)
  }

  async close(): Promise<void> {
    this.stopped = true
    this.hostAbort?.abort()
    this.registration?.close()
    clearTimeout(this.retry)
    this.pairing?.clear()
    for (const link of this.links.values()) link.abort.abort()
    for (const abort of this.outgoing.values()) abort.abort()
    for (const session of this.incoming) session.destroy()
    for (const connection of this.connections.values()) connection.session.destroy()
    await Promise.allSettled([...this.views.values()].map(async pending => (await pending).close()))
    this.views.clear()
  }
}
