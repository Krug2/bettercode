import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import test from "node:test"

const { getOrCreateInstallId, startAppPing } = createRequire(import.meta.url)("../apps/shell/shared/app-ping.cjs")

function profile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-ping-test-"))
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()))
    assert.ok(path.basename(dir).startsWith("betterc0de-ping-test-"))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

function setup(t, overrides = {}) {
  const dataDir = profile(t)
  let tick
  let interval
  let cleared = false
  const calls = []
  const stop = startAppPing({
    dataDir, appVersion: "0.1.0-beta.1", os: "win32", arch: "x64",
    setIntervalImpl: (callback, delay) => { tick = callback; interval = delay; return { unref() {} } },
    clearIntervalImpl: () => { cleared = true },
    fetchImpl: async (...args) => { calls.push(args); return new Response(null, { status: 204 }) },
    ...overrides,
  })
  t.after(stop)
  return { dataDir, tick: () => tick(), interval, calls, stop, cleared: () => cleared }
}

test("creates a persistent random installation ID and reuses it across startups", (t) => {
  const dir = profile(t)
  const id = getOrCreateInstallId(dir)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(getOrCreateInstallId(dir), id)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "installation.json"), "utf8")), { id })
  assert.notEqual(getOrCreateInstallId(profile(t)), id)
})

test("repairs invalid saved identity once and then keeps the replacement", (t) => {
  const dir = profile(t)
  fs.writeFileSync(path.join(dir, "installation.json"), '{"id":"invalid"}')
  const id = getOrCreateInstallId(dir)
  assert.notEqual(id, "invalid")
  assert.equal(getOrCreateInstallId(dir), id)
})

test("sends exactly the requested payload every 25 seconds, with no startup ping", async (t) => {
  const ping = setup(t)
  assert.equal(ping.interval, 25_000)
  assert.equal(ping.calls.length, 0)
  await ping.tick()
  await ping.tick()
  assert.equal(ping.calls.length, 2)
  const [url, options] = ping.calls[0]
  assert.equal(url, "https://betterc0de.com/api/ping")
  assert.equal(options.method, "POST")
  assert.deepEqual(options.headers, { "Content-Type": "application/json" })
  assert.deepEqual(JSON.parse(options.body), {
    id: getOrCreateInstallId(ping.dataDir), appVersion: "0.1.0-beta.1", os: "win32", arch: "x64",
  })
  assert.equal(options.body, ping.calls[1][1].body)
  assert.equal(options.redirect, "error")
})

test("offline failures are swallowed and the following interval tries again", async (t) => {
  let calls = 0
  const ping = setup(t, { fetchImpl: async () => { calls += 1; throw new Error("offline") } })
  await assert.doesNotReject(ping.tick())
  await assert.doesNotReject(ping.tick())
  assert.equal(calls, 2)
})

test("does not overlap requests and aborts an in-flight ping on shutdown", async (t) => {
  let calls = 0
  let signal
  const ping = setup(t, { fetchImpl: (_url, options) => {
    calls += 1
    signal = options.signal
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  } })
  const first = ping.tick()
  await ping.tick()
  assert.equal(calls, 1)
  ping.stop()
  await first
  assert.equal(signal.aborted, true)
  assert.equal(ping.cleared(), true)
  await ping.tick()
  assert.equal(calls, 1)
})

test("times out a stalled request and permits a later tick", async (t) => {
  let calls = 0
  const ping = setup(t, { timeoutMs: 5, fetchImpl: (_url, { signal }) => {
    calls += 1
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  } })
  await ping.tick()
  await ping.tick()
  assert.equal(calls, 2)
})

test("an unwritable identity location does not prevent startup or schedule a timer", (t) => {
  const dir = profile(t)
  const file = path.join(dir, "file-not-directory")
  fs.writeFileSync(file, "test")
  let scheduled = false
  const stop = startAppPing({ dataDir: file, appVersion: "test", setIntervalImpl: () => { scheduled = true } })
  assert.equal(scheduled, false)
  assert.doesNotThrow(stop)
})
