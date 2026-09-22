import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { DeviceVault } from "./vault"

const directories: string[] = []
const filename = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "device-vault-"))
  directories.push(dir)
  return path.join(dir, "devices.enc")
}
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe("device vault", () => {
  it("persists encrypted identities and fails closed for a missing or wrong key", async () => {
    const file = filename()
    const key = randomBytes(32)
    const vault = new DeviceVault(file, key)
    const identity = await vault.identity()
    expect(fs.readFileSync(file, "utf8")).not.toContain("PRIVATE KEY")
    expect(await new DeviceVault(file, key).identity()).toEqual(identity)
    expect(() => new DeviceVault(file, randomBytes(32))).toThrow("could not be unlocked")
    expect(() => new DeviceVault(file, null)).toThrow("could not be unlocked")
  })

  it("keeps temporary identities off disk and shares concurrent initialization", async () => {
    const file = filename()
    const vault = new DeviceVault(file, null)
    const identities = await Promise.all([vault.identity(), vault.identity()])
    expect(identities[0]).toEqual(identities[1])
    expect(vault.persistent).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })
})
