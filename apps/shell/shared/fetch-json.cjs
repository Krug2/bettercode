/** Bounded JSON requests for shell-owned credential and backend endpoints. */
async function fetchJson(url, init = {}, { timeoutMs = 15_000, maxBytes = 256 * 1024 } = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`JSON request failed: HTTP ${response.status}`)
  }
  if (!response.body) throw new Error("JSON response body is missing")
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) throw new Error(`JSON response exceeds ${maxBytes} bytes`)
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8"))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

module.exports = { fetchJson }
