import { generateKeyPairSync, sign, createHash } from "node:crypto"
import { once } from "node:events"
import { WebSocket } from "ws"
import { afterEach, describe, expect, it } from "vitest"
import { channelFrame, readChannelFrame } from "@betterc0de/remote-protocol"
import { startRelay } from "./server"

const relays: Awaited<ReturnType<typeof startRelay>>[] = []
afterEach(async () => { for (const relay of relays.splice(0)) await relay.close() })
const message = async (socket: WebSocket) => JSON.parse((await once(socket, "message"))[0].toString())
async function register(url: string) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" })
  const socket = new WebSocket(`${url}/v1/relay`)
  const challenge = await message(socket)
  const registered = message(socket)
  socket.send(JSON.stringify({ type: "register", version: 1, publicKey: publicKey.toString("base64url"), signature: sign("sha256", Buffer.from(`bettercode-relay-v1:${challenge.challenge}`), keys.privateKey).toString("base64url") }))
  expect((await registered).id).toBe(createHash("sha256").update(publicKey).digest("hex"))
  return { socket, id: createHash("sha256").update(publicKey).digest("hex") }
}

describe("relay server", () => {
  it("routes opaque bytes only between the selected host and client", async () => {
    const relay = await startRelay({ port: 0 })
    relays.push(relay)
    const first = await register(relay.url)
    const second = await register(relay.url)
    let leaked = false
    second.socket.on("message", () => { leaked = true })
    const client = new WebSocket(`${relay.url}/v1/relay`)
    await message(client)
    const opening = message(first.socket)
    const connected = message(client)
    client.send(JSON.stringify({ type: "connect", version: 1, hostId: first.id }))
    const channel = await opening
    expect((await connected).type).toBe("connected")
    const atHost = once(first.socket, "message")
    client.send(Buffer.from([0, 255, 1]))
    expect(readChannelFrame((await atHost)[0])).toEqual({ id: channel.id, data: Buffer.from([0, 255, 1]) })
    const atClient = once(client, "message")
    first.socket.send(channelFrame(channel.id, Buffer.from([4, 5])))
    expect((await atClient)[0]).toEqual(Buffer.from([4, 5]))
    expect(leaked).toBe(false)
    const closed = once(client, "close")
    first.socket.close()
    await closed
  })

  it("rejects forged registrations and incompatible versions", async () => {
    const relay = await startRelay({ port: 0 })
    relays.push(relay)
    for (const body of [{ type: "register", version: 1, publicKey: "bad", signature: "bad" }, { type: "connect", version: 999, hostId: "a".repeat(64) }]) {
      const socket = new WebSocket(`${relay.url}/v1/relay`)
      await message(socket)
      const closed = once(socket, "close")
      socket.send(JSON.stringify(body))
      expect((await closed)[0]).toBe(4001)
    }
  })
})
