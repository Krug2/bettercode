import assert from "node:assert/strict"
import http from "node:http"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { fetchJson } = require("../apps/shell/shared/fetch-json.cjs")

async function serverFor(t, handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  return `http://127.0.0.1:${server.address().port}`
}

test("bounded requests preserve split UTF-8 and reject invalid or oversized JSON", async (t) => {
  const url = await serverFor(t, (req, res) => {
    if (req.url === "/invalid") return res.end("not json")
    if (req.url === "/oversized") return res.end('"' + "x".repeat(100) + '"')
    for (const byte of Buffer.from('{"name":"Grüße 🦊"}')) res.write(Buffer.from([byte]))
    res.end()
  })
  assert.deepEqual(await fetchJson(url), { name: "Grüße 🦊" })
  await assert.rejects(fetchJson(`${url}/invalid`), SyntaxError)
  await assert.rejects(fetchJson(`${url}/oversized`, {}, { maxBytes: 32 }), /exceeds 32/)
})

test("deadline covers a stalled response body, and redirects are not followed", { timeout: 3000 }, async (t) => {
  let redirected = false
  const url = await serverFor(t, (req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/target" }); res.end(); return
    }
    if (req.url === "/target") { redirected = true; res.end("{}"); return }
    res.writeHead(200, { "Content-Type": "application/json" })
    res.write('{"pending":')
  })
  await assert.rejects(fetchJson(url, {}, { timeoutMs: 100 }), /abort|timeout/i)
  await assert.rejects(fetchJson(`${url}/redirect`))
  assert.equal(redirected, false)
})
