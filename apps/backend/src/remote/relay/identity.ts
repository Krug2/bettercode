import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto"
import { generate } from "selfsigned"

export interface DeviceIdentity {
  certificate: string
  privateKey: string
}

export function certificateId(certificate: string | Buffer): string {
  const parsed = new X509Certificate(certificate)
  return createHash("sha256").update(parsed.publicKey.export({ type: "spki", format: "der" })).digest("hex")
}

export function validateIdentity(identity: DeviceIdentity): void {
  const certificate = new X509Certificate(identity.certificate)
  const publicKey = createPublicKey(createPrivateKey(identity.privateKey)).export({ type: "spki", format: "der" })
  if (!publicKey.equals(certificate.publicKey.export({ type: "spki", format: "der" })))
    throw new Error("Device certificate does not match its key")
}

export function validatePeerCertificate(certificate: string | Buffer): X509Certificate {
  const parsed = new X509Certificate(certificate)
  if (Date.parse(parsed.validFrom) > Date.now() || Date.parse(parsed.validTo) <= Date.now())
    throw new Error("Device certificate has expired or is not yet valid")
  if (parsed.publicKey.asymmetricKeyType !== "ec" || !parsed.verify(parsed.publicKey))
    throw new Error("Invalid device certificate")
  return parsed
}

export async function createDeviceIdentity(): Promise<DeviceIdentity> {
  const now = Date.now()
  const generated = await generate([{ name: "commonName", value: "bettercode.remote" }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate: new Date(now - 300_000),
    notAfterDate: new Date(now + 2 * 365 * 24 * 60 * 60 * 1000),
  })
  return { certificate: generated.cert, privateKey: generated.private }
}
