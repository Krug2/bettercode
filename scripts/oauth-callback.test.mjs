import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const source = readFileSync(new URL("../apps/shell/oauth/index.cjs", import.meta.url), "utf8")

function fixture(listenError) {
  const timers = new Set()
  let listener
  const server = new EventEmitter()
  server.closeCount = 0
  server.close = () => { server.closeCount++ }
  server.listen = (_port, _host, ready) => {
    if (listenError) queueMicrotask(() => server.emit("error", new Error("EADDRINUSE")))
    else queueMicrotask(ready)
  }
  const module = { exports: {} }
  runInNewContext(source, {
    module, URL,
    setTimeout: (fn) => { const timer = { fn, unref() {} }; timers.add(timer); return timer },
    clearTimeout: (timer) => timers.delete(timer),
    require: (name) => name === "node:http" ? { createServer: (callback) => { listener = callback; return server } } : require(name),
  })
  return {
    timers, server,
    start: () => module.exports.startCallbackServer({ port: 1455, expectedState: "expected" }),
    request: (url) => {
      const response = { status: null, writeHead(status) { this.status = status }, end() {} }
      listener({ url }, response)
      return response
    },
  }
}

test("all terminal callback paths release their deadline and listener", async () => {
  for (const query of ["state=expected&error=access_denied", "state=wrong&code=code", "state=expected"]) {
    const f = fixture()
    const callback = await f.start()
    const rejected = assert.rejects(callback.wait())
    f.request(`/auth/callback?${query}`)
    await rejected
    assert.equal(f.timers.size, 0, query)
    assert.equal(f.server.closeCount, 1)
  }
})

test("listen failure and explicit cancellation clean up callback state", async () => {
  const failed = fixture(true)
  await assert.rejects(failed.start(), /EADDRINUSE/)
  assert.equal(failed.timers.size, 0)
  const f = fixture()
  const callback = await f.start()
  const rejected = assert.rejects(callback.wait(), /cancel/i)
  callback.close()
  assert.equal(f.timers.size, 0)
  await rejected
})

test("OAuth errors must carry the expected state before they are accepted", async () => {
  const f = fixture()
  const callback = await f.start()
  const rejected = assert.rejects(callback.wait(), /Invalid state/)
  const response = f.request("/auth/callback?state=wrong&error=access_denied")
  await rejected
  assert.equal(response.status, 400)
})

test("success and timeout settle once and clear the deadline", async () => {
  const success = fixture()
  const callback = await success.start()
  success.request("/auth/callback?state=expected&code=code")
  assert.equal((await callback.wait()).code, "code")
  callback.close()
  assert.equal(success.timers.size, 0)
  assert.equal(success.server.closeCount, 1)
  const failure = fixture()
  const timed = await failure.start()
  const rejected = assert.rejects(timed.wait(), /timeout/)
  Array.from(failure.timers)[0].fn()
  await rejected
  assert.equal(failure.timers.size, 0)
})
