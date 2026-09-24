import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const shellDirectory = fileURLToPath(new URL("../apps/shell/", import.meta.url))
const source = readFileSync(path.join(shellDirectory, "main.cjs"), "utf8")
const start = source.indexOf("const PREVIEW_PRELOAD_PATH =")
const end = source.indexOf("function createWindow()", start)
assert.ok(start >= 0 && end > start)
const previewPartition = "persist:test-preview"
const canvasPartition = "persist:test-canvas"
const workspacePartition = "persist:test-workspace"
const workspaceSession = {}

function attach(preferences, params, guest) {
  const listeners = new Map()
  runInNewContext(`${source.slice(start, end)}\nattachWebviewPolicy(contents)`, {
    path, require, process, __dirname: shellDirectory,
    ...require("../apps/shell/shared/urlPolicy.cjs"),
    PREVIEW_SESSION_PARTITION: previewPartition,
    CANVAS_PREVIEW_PARTITION: canvasPartition,
    WORKSPACE_BROWSER_PARTITION: workspacePartition,
    session: { fromPartition: () => workspaceSession },
    contents: { on: (channel, listener) => listeners.set(channel, listener) },
  })
  let prevented = false
  listeners.get("will-attach-webview")({ preventDefault: () => { prevented = true } }, preferences, params)
  if (guest) listeners.get("did-attach-webview")({}, guest)
  return prevented
}

test("guest preferences cannot disable web security or enable nested Node contexts", () => {
  const preferences = {
    nodeIntegration: true, nodeIntegrationInWorker: true, nodeIntegrationInSubFrames: true,
    contextIsolation: false, sandbox: false, webSecurity: false,
    allowRunningInsecureContent: true, webviewTag: true,
    preload: "/untrusted/preload.cjs", additionalArguments: ["--untrusted"],
  }
  const params = { src: "https://example.com", partition: "persist:default" }
  assert.equal(attach(preferences, params), false)
  for (const flag of ["nodeIntegration", "nodeIntegrationInWorker", "nodeIntegrationInSubFrames", "allowRunningInsecureContent", "webviewTag"]) {
    assert.equal(preferences[flag], false, flag)
  }
  for (const flag of ["contextIsolation", "sandbox", "webSecurity"]) assert.equal(preferences[flag], true, flag)
  assert.equal(preferences.partition, previewPartition)
  assert.equal(params.partition, previewPartition)
  assert.equal(preferences.preload, undefined)
  assert.equal(preferences.additionalArguments.length, 0)
})

test("workspace guests remain isolated and popup links become workspace windows", () => {
  const preferences = { nodeIntegration: true, preload: "/untrusted.cjs" }
  const params = { src: "https://github.com", partition: workspacePartition }
  const sent = []
  let open
  attach(preferences, params, { session: workspaceSession, setWindowOpenHandler: handler => { open = handler }, send: (...args) => sent.push(args) })
  assert.equal(preferences.partition, workspacePartition)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.deepEqual([...preferences.additionalArguments], ["--betterc0de-canvas-preview", "--betterc0de-workspace-browser"])
  assert.equal(open({ url: "file:///private.txt" }).action, "deny")
  assert.equal(sent.length, 0)
  assert.equal(open({ url: "https://github.com/example" }).action, "deny")
  assert.deepEqual(sent, [["workspace-open-url", "https://github.com/example"]])
})

test("canvas guests retain only the app bridge and unapproved URL schemes are blocked", () => {
  const preferences = { preloadURL: "file:///untrusted/preload.cjs" }
  const params = { src: "http://localhost:8080", partition: canvasPartition }
  assert.equal(attach(preferences, params), false)
  assert.equal(preferences.preload, path.join(shellDirectory, "browser-preview-preload.cjs"))
  assert.equal(preferences.preloadURL, undefined)
  assert.deepEqual([...preferences.additionalArguments], ["--betterc0de-canvas-preview"])
  assert.equal(preferences.partition, canvasPartition)
  assert.equal(attach({}, { src: "file:///private.txt" }), true)
  assert.equal(attach({}, { src: "javascript:alert(1)" }), true)
})
