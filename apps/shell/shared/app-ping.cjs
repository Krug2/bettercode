const path = require("node:path")
const { randomUUID } = require("node:crypto")
const { readJson, writeJson } = require("./json-fs.cjs")

const PING_URL = "https://betterc0de.com/api/ping"
const PING_INTERVAL_MS = 25_000

function getOrCreateInstallId(dataDir) {
  const file = path.join(dataDir, "installation.json")
  const saved = readJson(file, null, { maxBytes: 1024 })
  if (typeof saved?.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id)) {
    return saved.id
  }
  const id = randomUUID()
  writeJson(file, { id }, { maxBytes: 1024 })
  return id
}

/** One timer in the main process, independent of renderer windows/reloads. */
function startAppPing({
  dataDir, appVersion, os = process.platform, arch = process.arch,
  fetchImpl = fetch, timeoutMs = 10_000,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
}) {
  let id
  try {
    id = getOrCreateInstallId(dataDir)
  } catch {
    // A read-only profile must not prevent startup or create a new identity every ping.
    return () => {}
  }
  const body = JSON.stringify({ id, appVersion, os, arch })
  let stopped = false
  let pending = false
  let controller
  const timer = setIntervalImpl(async () => {
    if (stopped || pending) return
    pending = true
    controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(PING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
        redirect: "error",
      })
      await response.body?.cancel()
    } catch {
      // Offline or server errors are silent; the next interval tries again.
    } finally {
      clearTimeout(timeout)
      controller = undefined
      pending = false
    }
  }, PING_INTERVAL_MS)
  timer.unref?.()

  return () => {
    stopped = true
    clearIntervalImpl(timer)
    controller?.abort()
  }
}

module.exports = { getOrCreateInstallId, startAppPing }
