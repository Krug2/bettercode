import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const source = readFileSync(new URL("./backend-startup-smoke.mjs", import.meta.url), "utf8")
  .replace(/^import .*\n/gm, "")
  .replaceAll("import.meta.dirname", "scriptDir")

async function runSmoke(metrics, checkFetch = () => {}) {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  let stdoutDrained = false
  child.stdout = { resume: () => { stdoutDrained = true } }
  child.exitCode = null
  child.signalCode = null
  child.kill = () => {
    child.exitCode = 0
    queueMicrotask(() => child.emit("exit", 0))
    return true
  }
  const messages = []
  const process = {
    execPath: "node", env: {}, argv: ["node", "smoke", "--rss-budget-mb=384"],
    stdout: { write: value => messages.push(value) },
    stderr: { write: value => messages.push(value) },
  }
  const timers = new Set()
  try {
    await runInNewContext(`(async () => { ${source}\n })()`, {
      process, os, path, performance, AbortSignal, scriptDir: path.join(os.tmpdir(), "fixture", "scripts"),
      mkdtemp: async () => path.join(os.tmpdir(), "betterc0de-smoke-fixture"), rm: async () => {},
      spawn: () => {
        queueMicrotask(() => child.stderr.emit("data", Buffer.from('{"status":"ready","port":12345,"token":"fixture-only"}\n')))
        return child
      },
      fetch: async (url, options) => {
        checkFetch(options)
        return { ok: true, json: async () => url.endsWith("/health") ? { status: "ok" } : metrics }
      },
      setTimeout: (callback, ms) => { const timer = setTimeout(callback, ms); timers.add(timer); return timer },
      clearTimeout,
    })
    return { exitCode: process.exitCode ?? 0, messages: messages.join(""), stdoutDrained }
  } finally {
    for (const timer of timers) clearTimeout(timer)
  }
}

test("startup smoke rejects missing, nonnumeric and nonpositive RSS", async () => {
  for (const rss of [undefined, "invalid", 0, -1]) {
    const result = await runSmoke({ memory: { rss } })
    assert.equal(result.exitCode, 1, `RSS ${String(rss)} must fail the gate`)
    assert.match(result.messages, /invalid.*RSS/i)
    assert.doesNotMatch(result.messages, /fixture-only/)
  }
})

test("startup smoke bounds both HTTP requests and drains child stdout", async () => {
  let requests = 0
  const result = await runSmoke({ memory: { rss: 128 * 1024 * 1024 } }, options => {
    assert.ok(options?.signal instanceof AbortSignal)
    requests++
  })
  assert.equal(result.exitCode, 0, result.messages)
  assert.equal(requests, 2)
  assert.equal(result.stdoutDrained, true)
})
