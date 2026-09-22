import { startRelay } from "./server"

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}

async function main() {
  const relay = await startRelay({
    host: process.env.RELAY_HOST || "127.0.0.1",
    port: positive("PORT", 8080),
    maxConnections: positive("RELAY_MAX_CONNECTIONS", 1024),
    maxPeersPerHost: positive("RELAY_MAX_PEERS", 16),
    maxBytesPerSecond: positive("RELAY_BYTES_PER_SECOND", 8 * 1024 * 1024),
  })
  process.stdout.write(`relay listening on port ${(relay.server.address() as { port: number }).port}\n`)
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void relay.close().catch(() => { process.exitCode = 1 })
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}

void main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
