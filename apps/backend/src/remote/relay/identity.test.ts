import { describe, expect, it } from "vitest"
import { certificateId, createDeviceIdentity, validateIdentity, validatePeerCertificate } from "./identity"

describe("device identities", () => {
  it("creates distinct valid identities and rejects mismatched private keys", async () => {
    const first = await createDeviceIdentity()
    const second = await createDeviceIdentity()
    validateIdentity(first)
    validatePeerCertificate(first.certificate)
    expect(certificateId(first.certificate)).toMatch(/^[a-f0-9]{64}$/)
    expect(certificateId(first.certificate)).not.toBe(certificateId(second.certificate))
    expect(() => validateIdentity({ certificate: first.certificate, privateKey: second.privateKey })).toThrow("does not match")
    expect(() => validatePeerCertificate("invalid")).toThrow()
  })
})
