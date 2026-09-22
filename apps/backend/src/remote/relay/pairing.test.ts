import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type tls from "node:tls"
import { afterEach, expect, it, vi } from "vitest"
import { openDatabase } from "../../persistence/db"
import { runMigrations } from "../../persistence/migrations"
import { RemoteAccessService } from "../service"
import { certificateId, createDeviceIdentity } from "./identity"
import { DevicePairing, pairingCode, readInvitation } from "./pairing"
import { DeviceVault } from "./vault"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bettercode-pairing-"))
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  const db = openDatabase(path.join(directory, "test.sqlite"))
  runMigrations(db)
  cleanups.push(() => { db.close() })
  const access = new RemoteAccessService(db, { isEnabled: () => true })
  cleanups.push(() => access.close())
  const vault = new DeviceVault(path.join(directory, "devices"), null)
  const pairing = new DevicePairing(vault, access)
  cleanups.push(() => pairing.clear())
  const identity = await createDeviceIdentity()
  const peer = { id: certificateId(identity.certificate), certificate: identity.certificate, socket: null as unknown as tls.TLSSocket }
  const issued = await pairing.invite("https://relay.example.com", "host")
  const invitation = readInvitation(issued.code)
  return { access, vault, pairing, peer, invitation }
}

it("requires owner approval, consumes the invitation once, and binds permissions to the certificate", async () => {
  const { access, vault, pairing, peer, invitation } = await fixture()
  const controller = new AbortController()
  const result = pairing.request(peer, invitation.token, "viewer", controller.signal)
  await vi.waitFor(() => expect(pairing.pending()).toHaveLength(1))
  expect(access.listSessions()).toHaveLength(0)
  await expect(pairing.request(peer, invitation.token, "intruder", controller.signal)).rejects.toThrow("invalid or expired")
  const request = pairing.pending()[0]!
  expect(request.code).toBe(pairingCode(invitation.hostId, peer.id, invitation.token))
  pairing.approve(request.id, { accessLevel: "read_only", allowTerminal: true })
  const grant = await result
  expect(grant).toMatchObject({ id: peer.id, accessLevel: "read_only", allowTerminal: false })
  expect(vault.grants()).toEqual([grant])
  expect(access.authenticate(grant.sessionToken)?.id).toBe(grant.sessionId)
  await access.revokeSessionAndWait(grant.sessionId)
  expect(access.authenticate(grant.sessionToken)).toBeNull()
})

it("cancels pending approval without issuing a session", async () => {
  const { access, pairing, peer, invitation } = await fixture()
  const controller = new AbortController()
  const request = pairing.request(peer, invitation.token, "viewer", controller.signal)
  const rejected = expect(request).rejects.toThrow("declined or expired")
  await vi.waitFor(() => expect(pairing.pending()).toHaveLength(1))
  controller.abort()
  await rejected
  expect(pairing.pending()).toEqual([])
  expect(access.listSessions()).toEqual([])
})
