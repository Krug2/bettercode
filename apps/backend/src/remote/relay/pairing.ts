import { createHash, randomBytes, randomUUID } from "node:crypto"
import { relayUrl } from "@betterc0de/remote-protocol"
import { z } from "zod"
import type { RemoteAccessService } from "../service"
import { certificateId, validatePeerCertificate } from "./identity"
import { DeviceRequestError } from "./http-channel"
import type { SecurePeer } from "./tls-channel"
import type { DeviceGrant, DeviceVault } from "./vault"

export const deviceLabel = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/)
export const devicePermission = z.object({ accessLevel: z.enum(["full", "read_only"]), allowTerminal: z.boolean().default(false) })
const invitationSchema = z.object({
  version: z.literal(1), relayUrl: z.string().max(2048), hostId: z.string().regex(/^[a-f0-9]{64}$/),
  certificate: z.string().max(8192), token: z.string().regex(/^[\w-]{43}$/), expiresAt: z.string().datetime(), label: deviceLabel,
})
export type DeviceInvitation = z.infer<typeof invitationSchema>

export function readInvitation(code: string): DeviceInvitation {
  if (code.length > 16_384 || !code.trim().startsWith("bettercode-device:")) throw new Error("Invalid device invitation")
  const value = invitationSchema.parse(JSON.parse(Buffer.from(code.trim().slice(18), "base64url").toString()))
  value.relayUrl = relayUrl(value.relayUrl)
  validatePeerCertificate(value.certificate)
  if (certificateId(value.certificate) !== value.hostId || Date.parse(value.expiresAt) <= Date.now())
    throw new Error("Device invitation is invalid or expired")
  return value
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex") }

export function pairingCode(hostId: string, viewerId: string, token: string): string {
  return hash(`${hostId}:${viewerId}:${token}`).slice(0, 16).match(/.{4}/g)!.join(" ")
}

interface PendingApproval {
  id: string
  peerId: string
  label: string
  code: string
  expiresAt: string
  finish(permission?: z.infer<typeof devicePermission>): void
}

export class DevicePairing {
  private readonly invitations = new Map<string, number>()
  private readonly approvals = new Map<string, PendingApproval>()

  constructor(private readonly vault: DeviceVault, private readonly access: RemoteAccessService) {}

  pending() {
    return [...this.approvals.values()].map(({ id, peerId, label, code, expiresAt }) => ({ id, peerId, label, code, expiresAt }))
  }

  async invite(address: string, label: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.access.enabled()) throw new Error("Device sharing is disabled")
    const identity = await this.vault.identity()
    for (const [token, expires] of this.invitations) if (expires < Date.now()) this.invitations.delete(token)
    if (this.invitations.size >= 4) this.invitations.delete(this.invitations.keys().next().value!)
    const token = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
    const invitation: DeviceInvitation = {
      version: 1, relayUrl: relayUrl(address), hostId: certificateId(identity.certificate),
      certificate: identity.certificate, token, expiresAt, label: deviceLabel.parse(label),
    }
    this.invitations.set(hash(token), Date.parse(expiresAt))
    return { code: `bettercode-device:${Buffer.from(JSON.stringify(invitation)).toString("base64url")}`, expiresAt }
  }

  async request(peer: SecurePeer, token: string, label: string, signal: AbortSignal): Promise<DeviceGrant> {
    signal.throwIfAborted()
    const expires = this.invitations.get(hash(token))
    if (!this.access.enabled() || !expires || expires <= Date.now() || this.approvals.size >= 8)
      throw new DeviceRequestError("Invitation is invalid or expired", 403)
    const safeLabel = deviceLabel.parse(label)
    this.invitations.delete(hash(token))
    const host = await this.vault.identity()
    signal.throwIfAborted()
    const permission = await new Promise<z.infer<typeof devicePermission>>((resolve, reject) => {
      const id = randomUUID()
      const finish = (value?: z.infer<typeof devicePermission>) => {
        this.approvals.delete(id)
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        if (value) resolve(value)
        else reject(new DeviceRequestError("Device approval was declined or expired", 403))
      }
      const cancel = () => finish()
      const timeout = Math.min(110_000, expires - Date.now())
      const timer = setTimeout(cancel, Math.max(1, timeout))
      timer.unref()
      signal.addEventListener("abort", cancel, { once: true })
      this.approvals.set(id, {
        id, peerId: peer.id, label: safeLabel,
        code: pairingCode(certificateId(host.certificate), peer.id, token),
        expiresAt: new Date(Date.now() + timeout).toISOString(), finish,
      })
    })
    signal.throwIfAborted()
    if (!this.access.enabled()) throw new DeviceRequestError("Device sharing is disabled", 403)
    const previous = this.vault.grants().find(grant => grant.id === peer.id)
    if (previous) await this.access.revokeSessionAndWait(previous.sessionId)
    signal.throwIfAborted()
    const pairing = this.access.issuePairingGrant({ label: safeLabel })
    const session = this.access.consumePairingCredential(pairing.credential, { label: safeLabel, accessLevel: permission.accessLevel })
    if (!session) throw new Error("Device session could not be issued")
    const grant: DeviceGrant = {
      id: peer.id, label: safeLabel, certificate: peer.certificate, createdAt: session.createdAt,
      sessionId: session.id, sessionToken: session.token, expiresAt: session.expiresAt,
      accessLevel: permission.accessLevel, allowTerminal: permission.accessLevel === "full" && permission.allowTerminal,
    }
    try { this.vault.putGrant(grant) }
    catch (error) { await this.access.revokeSessionAndWait(session.id); throw error }
    return grant
  }

  approve(id: string, permission?: z.infer<typeof devicePermission>): void {
    const pending = this.approvals.get(id)
    if (!pending) throw new DeviceRequestError("Pairing request has expired", 404)
    pending.finish(permission && devicePermission.parse(permission))
  }

  clear(): void {
    this.invitations.clear()
    for (const pending of this.approvals.values()) pending.finish()
  }
}
