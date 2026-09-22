import { randomBytes } from "node:crypto"
import { afterEach, expect, it } from "vitest"
import { startRelay } from "../../apps/relay/src/server"
import { certificateId, createDeviceIdentity } from "../../apps/backend/src/remote/relay/identity"
import { connectRelay, registerRelayHost } from "../../apps/backend/src/remote/relay/connection"
import { secureClient, secureServer } from "../../apps/backend/src/remote/relay/tls-channel"
import { acceptDeviceSession, openDeviceSession } from "../../apps/backend/src/remote/relay/http-channel"

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it("multiplexes encrypted requests through a real relay and closes on disconnect", async () => {
  const relay = await startRelay({ port: 0 })
  cleanup.push(() => relay.close())
  const [host, viewer] = await Promise.all([createDeviceIdentity(), createDeviceIdentity()])
  const payload = randomBytes(256 * 1024)
  const registered = await registerRelayHost(relay.url, host, raw => {
    void secureServer(raw, host).then(peer => {
      expect(peer.id).toBe(certificateId(viewer.certificate))
      const session = acceptDeviceSession(peer)
      session.on("error", () => undefined)
      session.on("stream", stream => {
        stream.on("error", () => undefined)
        stream.respond({ ":status": 200 })
        stream.end(payload)
      })
      cleanup.push(() => session.destroy())
    })
  })
  cleanup.push(() => registered.close())
  const raw = await connectRelay(relay.url, certificateId(host.certificate))
  const peer = await secureClient(raw, viewer, host.certificate)
  const session = openDeviceSession(peer)
  session.on("error", () => undefined)
  cleanup.push(() => session.destroy())
  await Promise.all(Array.from({ length: 3 }, async () => {
    const request = session.request({ ":path": "/test" })
    request.end()
    const chunks: Buffer[] = []
    for await (const data of request) chunks.push(data)
    expect(Buffer.concat(chunks)).toEqual(payload)
  }))
  const closed = new Promise<void>(resolve => session.once("close", resolve))
  registered.close()
  await closed
}, 15_000)

it("rejects unavailable devices and cancellation without leaking a connection", async () => {
  const relay = await startRelay({ port: 0 })
  cleanup.push(() => relay.close())
  await expect(connectRelay(relay.url, "a".repeat(64))).rejects.toThrow()
  const controller = new AbortController()
  controller.abort()
  await expect(connectRelay(relay.url, "a".repeat(64), controller.signal)).rejects.toThrow()
})
