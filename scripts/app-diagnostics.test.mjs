import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import test from "node:test"

const { createAppDiagnostics } = createRequire(import.meta.url)("../apps/shell/shared/app-diagnostics.cjs")

function setup(t, options = {}) {
  const forwarded = []
  const logger = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((level) => [level, (...args) => forwarded.push([level, ...args])]))
  const originals = { ...logger }
  const payloads = []
  let time = 100_000
  const diagnostics = createAppDiagnostics({
    logger, appVersion: "1.2.3", os: "win32", arch: "x64", installId: "persistent-installation", now: () => time,
    fetchImpl: async (_url, options) => { payloads.push(JSON.parse(options.body)); return new Response(null, { status: 204 }) },
    ...options,
  })
  t.after(() => diagnostics.dispose())
  return { diagnostics, logger, originals, forwarded, payloads, advance: (ms) => { time += ms } }
}

test("automatic errors include host identity, stack and the recent main-process logs", async (t) => {
  const { diagnostics, logger, forwarded, payloads } = setup(t)
  logger.info("Opening", "project")
  const error = new Error("Unexpected application failure")
  await diagnostics.reportError(error)
  assert.equal(payloads.length, 1)
  const payload = payloads[0]
  assert.ok(payload.message.startsWith(error.message))
  assert.equal(payload.stack, error.stack)
  assert.match(payload.logs, /Opening project/)
  assert.equal(payload.installId, "persistent-installation")
  assert.equal(payload.arch, "x64")
  assert.deepEqual(forwarded, [["info", "Opening", "project"]])
})

test("manual and automatic reports share the ten-second rate limit", async (t) => {
  const { diagnostics, payloads, advance } = setup(t)
  await diagnostics.sendReport({ message: "Manual report", stack: "", logs: "Renderer logs" })
  await diagnostics.reportError(new Error("Crash during cooldown"))
  assert.equal(payloads.length, 1)
  advance(10_000)
  await diagnostics.reportError(new Error("Later failure"))
  assert.equal(payloads.length, 2)
})

test("retains renderer logs for a native renderer crash and ignores normal termination", async (t) => {
  const { diagnostics, payloads } = setup(t)
  const contents = new EventEmitter()
  contents.mainFrame = {}
  diagnostics.attachRenderer(contents)
  diagnostics.attachRenderer(contents)
  assert.equal(contents.listenerCount("render-process-gone"), 1)
  contents.emit("console-message", { message: "Renderer working", level: "info", frame: contents.mainFrame })
  contents.emit("console-message", { message: "Untrusted subframe", level: "info", frame: {} })
  contents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 })
  contents.emit("render-process-gone", {}, { reason: "killed", exitCode: 1 })
  assert.equal(payloads.length, 0)
  contents.emit("render-process-gone", {}, { reason: "oom", exitCode: 1 })
  await diagnostics.flush()
  assert.equal(payloads.length, 1)
  assert.match(payloads[0].message, /reason=oom/)
  assert.match(payloads[0].logs, /Renderer working/)
  assert.doesNotMatch(payloads[0].logs, /Untrusted subframe/)
})

test("bounds log history and restores the original console methods", async (t) => {
  const { diagnostics, logger, originals, payloads } = setup(t)
  logger.log("old entry")
  for (let i = 0; i < 250; i += 1) logger.log(`entry ${i}: ${"x".repeat(5000)}`)
  await diagnostics.reportError(new Error("Latest error"))
  assert.ok(payloads[0].logs.length <= 64_000)
  assert.match(payloads[0].logs, /entry 249/)
  assert.doesNotMatch(payloads[0].logs, /old entry/)
  diagnostics.dispose()
  assert.equal(logger.log, originals.log)
})

test("reporting failures remain silent and a shutdown flush is bounded", async (t) => {
  const { diagnostics } = setup(t, { timeoutMs: 20, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }) })
  const pending = diagnostics.reportError(new Error("Offline failure"))
  await diagnostics.flush(5)
  await assert.doesNotReject(pending)
})

test("smoke tests can disable automatic uploads while retaining manual reports", async (t) => {
  const { diagnostics, payloads } = setup(t, { automaticReports: false })
  await diagnostics.reportError(new Error("Test error"))
  await diagnostics.sendReport({ message: "Renderer error", stack: "", automatic: true })
  assert.equal(payloads.length, 0)
  await diagnostics.sendReport({ message: "User report", stack: "" })
  assert.equal(payloads.length, 1)
})
