import { Duplex, PassThrough } from "node:stream"
import { once } from "node:events"
import { describe, expect, it } from "vitest"
import { createDeviceIdentity, certificateId } from "./identity"
import { secureClient, secureServer } from "./tls-channel"

function wire() {
  const outbound = new PassThrough()
  const inbound = new PassThrough()
  outbound.on("error", () => {})
  inbound.on("error", () => {})
  const captured: Buffer[] = []
  outbound.on("data", (data: Buffer) => captured.push(Buffer.from(data)))
  return {
    client: Duplex.from({ readable: inbound, writable: outbound }),
    server: Duplex.from({ readable: outbound, writable: inbound }),
    captured,
  }
}

describe("device secure channels", () => {
  it("authenticates both certificates and keeps application data off the relay", async () => {
    const host = await createDeviceIdentity()
    const viewer = await createDeviceIdentity()
    const transport = wire()
    const [server, client] = await Promise.all([
      secureServer(transport.server, host),
      secureClient(transport.client, viewer, host.certificate),
    ])
    try {
      expect(server.id).toBe(certificateId(viewer.certificate))
      expect(client.id).toBe(certificateId(host.certificate))
      const received = once(server.socket, "data")
      client.socket.write("private project contents")
      expect((await received)[0].toString()).toBe("private project contents")
      expect(Buffer.concat(transport.captured).includes(Buffer.from("private project contents"))).toBe(false)
    } finally {
      server.socket.destroy()
      client.socket.destroy()
    }
  })

  it("refuses an intermediary presenting another certificate", async () => {
    const host = await createDeviceIdentity()
    const impostor = await createDeviceIdentity()
    const transport = wire()
    const server = secureServer(transport.server, impostor).catch(() => null)
    try {
      await expect(secureClient(transport.client, host, host.certificate)).rejects.toThrow()
    } finally {
      transport.client.destroy()
      transport.server.destroy()
      await server
    }
  })
})
