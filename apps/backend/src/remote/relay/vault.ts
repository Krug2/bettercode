import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { decryptSecret, encryptSecret, getMasterKey, isEncrypted } from "../../settings/crypto"
import { certificateId, createDeviceIdentity, validateIdentity, type DeviceIdentity } from "./identity"

const peer = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  label: z.string().min(1).max(80),
  certificate: z.string().max(8192),
  createdAt: z.string().datetime(),
})
const grant = peer.extend({
  sessionId: z.string(),
  sessionToken: z.string(),
  expiresAt: z.string().datetime(),
  accessLevel: z.enum(["full", "read_only"]),
  allowTerminal: z.boolean(),
})
const host = peer.extend({
  environmentId: z.string(),
  relayUrl: z.string().max(2048),
  viewerPort: z.number().int().min(1024).max(65535).optional(),
  accessLevel: z.enum(["full", "read_only"]),
  expiresAt: z.string().datetime(),
})
const vaultSchema = z.object({
  version: z.literal(1),
  identity: z.object({ certificate: z.string().max(8192), privateKey: z.string().max(8192) }),
  grants: z.array(grant).max(64),
  hosts: z.array(host).max(64),
})

export type DeviceGrant = z.infer<typeof grant>
export type SavedHost = z.infer<typeof host>
type VaultData = z.infer<typeof vaultSchema>

export class DeviceVault {
  private data: VaultData | null = null
  private initializing: Promise<DeviceIdentity> | null = null
  readonly persistent: boolean

  constructor(private readonly file: string, private readonly key = getMasterKey()) {
    this.persistent = key !== null
    if (!fs.existsSync(file)) return
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error("Device storage is too large")
    const value = fs.readFileSync(file, "utf8")
    if (!isEncrypted(value)) throw new Error("Device storage must be encrypted")
    const decrypted = decryptSecret(value, key)
    if (!decrypted) throw new Error("Secure device storage could not be unlocked")
    this.data = vaultSchema.parse(JSON.parse(decrypted))
    validateIdentity(this.data.identity)
    for (const entry of [...this.data.grants, ...this.data.hosts]) {
      if (certificateId(entry.certificate) !== entry.id) throw new Error("Stored device identity is invalid")
    }
  }

  identity(): Promise<DeviceIdentity> {
    if (this.data) return Promise.resolve({ ...this.data.identity })
    this.initializing ??= createDeviceIdentity().then(identity => {
      this.save({ version: 1, identity, grants: [], hosts: [] })
      return { ...identity }
    }).catch(error => { this.initializing = null; throw error })
    return this.initializing
  }

  grants(): DeviceGrant[] { return structuredClone(this.data?.grants ?? []) }
  hosts(): SavedHost[] { return structuredClone(this.data?.hosts ?? []) }

  putGrant(value: DeviceGrant): void {
    this.change(data => { data.grants = [...data.grants.filter(entry => entry.id !== value.id), value] })
  }

  removeGrant(id: string): void {
    this.change(data => { data.grants = data.grants.filter(entry => entry.id !== id) })
  }

  putHost(value: SavedHost): void {
    this.change(data => { data.hosts = [...data.hosts.filter(entry => entry.id !== value.id), value] })
  }

  removeHost(id: string): void {
    this.change(data => { data.hosts = data.hosts.filter(entry => entry.id !== id) })
  }

  private change(update: (value: VaultData) => void): void {
    if (!this.data) throw new Error("Device identity is not ready")
    const next = structuredClone(this.data)
    update(next)
    this.save(vaultSchema.parse(next))
  }

  private save(next: VaultData): void {
    if (this.key) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      let fd: number | undefined
      try {
        fd = fs.openSync(temporary, "wx", 0o600)
        fs.writeFileSync(fd, encryptSecret(JSON.stringify(next), this.key), "utf8")
        fs.fsyncSync(fd)
        fs.closeSync(fd)
        fd = undefined
        fs.renameSync(temporary, this.file)
      } finally {
        if (fd !== undefined) fs.closeSync(fd)
        fs.rmSync(temporary, { force: true })
      }
    }
    this.data = structuredClone(next)
  }
}
