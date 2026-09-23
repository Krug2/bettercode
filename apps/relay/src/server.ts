import http from "node:http"
import { isIP } from "node:net"
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"
import { channelFrame, readChannelFrame, RELAY_FRAME_LIMIT, RELAY_QUEUE_LIMIT, RELAY_VERSION } from "@betterc0de/remote-protocol"

interface Host { id: string; socket: WebSocket; peers: Map<string, WebSocket> }
interface Peer { host: Host; id: string }
interface Budget { tokens: number; time: number }

export interface RelayOptions {
  host?: string
  port?: number
  maxConnections?: number
  maxPeersPerHost?: number
  maxBytesPerSecond?: number
  trustProxy?: boolean
}

export async function startRelay(options: RelayOptions = {}) {
  const hosts = new Map<string, Host>()
  const attempts = new Map<string, Budget>()
  const stats = { bytesForwarded: 0, rejected: 0 }
  const maxConnections = options.maxConnections ?? 1024
  const maxPeers = options.maxPeersPerHost ?? 16
  const byteRate = options.maxBytesPerSecond ?? 8 * 1024 * 1024
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Content-Type", "application/json")
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end('{"error":"not found"}')
      return
    }
    response.end(JSON.stringify({ version: RELAY_VERSION, hosts: hosts.size, connections: sockets.clients.size, ...stats }))
  })
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  server.maxConnections = maxConnections + 64
  const sockets = new WebSocketServer({ noServer: true, maxPayload: RELAY_FRAME_LIMIT, perMessageDeflate: false })

  server.on("upgrade", (request, socket, head) => {
    const forwarded = request.headers["x-bettercode-client-ip"]
    const ip = options.trustProxy && typeof forwarded === "string" && isIP(forwarded)
      ? forwarded : request.socket.remoteAddress ?? "unknown"
    const now = Date.now()
    for (const [key, value] of attempts) if (now - value.time > 60_000) attempts.delete(key)
    const budget = attempts.get(ip) ?? { tokens: 30, time: now }
    budget.tokens = Math.min(30, budget.tokens + (now - budget.time) / 2000)
    budget.time = now
    if (request.url !== "/v1/relay" || request.headers.origin || sockets.clients.size >= maxConnections
      || budget.tokens < 1 || (!attempts.has(ip) && attempts.size >= 4096)) {
      stats.rejected++
      socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }
    budget.tokens--
    attempts.set(ip, budget)
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws))
  })

  const send = (socket: WebSocket, data: string | Buffer) => {
    if (socket.readyState !== WebSocket.OPEN) return false
    if (socket.bufferedAmount + Buffer.byteLength(data) > RELAY_QUEUE_LIMIT) {
      socket.terminate()
      return false
    }
    socket.send(data, error => { if (error) socket.terminate() })
    return true
  }
  const control = (socket: WebSocket, value: unknown) => send(socket, JSON.stringify(value))

  sockets.on("connection", socket => {
    const challenge = randomBytes(32).toString("base64url")
    let host: Host | undefined
    let peer: Peer | undefined
    let alive = true
    const bandwidth = { tokens: byteRate * 2, time: Date.now() }
    const deadline = setTimeout(() => socket.terminate(), 10_000)
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate()
      alive = false
      socket.ping()
    }, 30_000)
    heartbeat.unref()
    socket.on("pong", () => { alive = true })
    socket.on("error", () => socket.terminate())
    control(socket, { type: "challenge", version: RELAY_VERSION, challenge })

    socket.on("message", (raw, binary) => {
      try {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
        const now = Date.now()
        bandwidth.tokens = Math.min(byteRate * 2, bandwidth.tokens + (now - bandwidth.time) * byteRate / 1000)
        bandwidth.time = now
        if (bandwidth.tokens < data.length) throw new Error("Connection quota exceeded")
        bandwidth.tokens -= data.length
        if (binary) {
          if (host) {
            const frame = readChannelFrame(data)
            const target = host.peers.get(frame.id)
            if (!target) return
            if (send(target, frame.data)) stats.bytesForwarded += frame.data.length
          } else if (peer) {
            if (!data.length || data.length > RELAY_FRAME_LIMIT - 16) throw new Error("Invalid relay frame")
            if (send(peer.host.socket, channelFrame(peer.id, data))) stats.bytesForwarded += data.length
          } else throw new Error("Registration required")
          return
        }
        if (data.length > 4096) throw new Error("Control frame too large")
        const value = JSON.parse(data.toString("utf8"))
        if (!value || typeof value !== "object") throw new Error("Invalid control frame")
        if (!host && !peer) {
          if (value.version !== RELAY_VERSION) throw new Error("Incompatible relay version")
          if (value.type === "register") {
            if (typeof value.publicKey !== "string" || typeof value.signature !== "string") throw new Error("Invalid registration")
            const keyBytes = Buffer.from(value.publicKey, "base64url")
            const key = createPublicKey({ key: keyBytes, type: "spki", format: "der" })
            if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
              || !verify("sha256", Buffer.from(`bettercode-relay-v1:${challenge}`), key, Buffer.from(value.signature, "base64url")))
              throw new Error("Invalid registration signature")
            const id = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex")
            hosts.get(id)?.socket.terminate()
            host = { id, socket, peers: new Map() }
            hosts.set(id, host)
            control(socket, { type: "registered", version: RELAY_VERSION, id })
          } else if (value.type === "connect") {
            if (typeof value.hostId !== "string" || !/^[a-f0-9]{64}$/.test(value.hostId)) throw new Error("Invalid host")
            const target = hosts.get(value.hostId)
            if (!target || target.peers.size >= maxPeers) throw new Error("Host unavailable")
            const id = randomBytes(16).toString("hex")
            peer = { host: target, id }
            target.peers.set(id, socket)
            control(target.socket, { type: "open", id })
            control(socket, { type: "connected", version: RELAY_VERSION })
          } else throw new Error("Registration required")
          clearTimeout(deadline)
        } else if (host && value.type === "close" && typeof value.id === "string") {
          host.peers.get(value.id)?.close(4000, "Host closed connection")
        } else throw new Error("Invalid control frame")
      } catch {
        stats.rejected++
        socket.close(4001, "Connection refused")
      }
    })
    socket.on("close", () => {
      clearTimeout(deadline)
      clearInterval(heartbeat)
      if (host) {
        if (hosts.get(host.id) === host) hosts.delete(host.id)
        for (const connected of host.peers.values()) connected.terminate()
      }
      if (peer) {
        peer.host.peers.delete(peer.id)
        control(peer.host.socket, { type: "close", id: peer.id })
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 8080, options.host ?? "127.0.0.1", () => { server.off("error", reject); resolve() })
  })
  return {
    server,
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    stats,
    async close() {
      for (const socket of sockets.clients) socket.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
