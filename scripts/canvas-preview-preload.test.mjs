import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function load(canvas) {
  const listeners = new Map(), sent = [], zoom = []
  runInNewContext(readFileSync(new URL("../apps/shell/browser-preview-preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "win32", argv: canvas ? ["--betterc0de-canvas-preview"] : [] },
    console,
    window: { innerWidth: 1000, innerHeight: 800, addEventListener: (type, fn) => listeners.set(type, fn) },
    document: { addEventListener: () => {} },
    require: () => ({ contextBridge: { exposeInMainWorld: () => {} }, ipcRenderer: { sendToHost: (...args) => sent.push(args) }, webFrame: { setVisualZoomLevelLimits: (...args) => zoom.push(args), executeJavaScript: () => Promise.resolve() } }),
  })
  return { listeners, sent, zoom }
}

test("only canvas guests capture trusted pinch/Ctrl-wheel; plain page scrolling stays native", () => {
  const { listeners, sent, zoom } = load(true)
  assert.deepEqual(zoom, [[1, 1]])
  let prevented = 0, stopped = 0
  const event = { isTrusted: true, ctrlKey: true, clientX: 250, clientY: 400, deltaY: -3, deltaMode: 1, preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++ }
  listeners.get("wheel")(event)
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  assert.equal(sent[0][0], "canvas-wheel")
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0][1])), { x: 0.25, y: 0.5, deltaY: -48 })
  listeners.get("wheel")({ ...event, ctrlKey: false })
  listeners.get("wheel")({ ...event, isTrusted: false })
  assert.equal(sent.length, 1)
  assert.equal(prevented, 1)
  assert.equal(load(false).listeners.has("wheel"), false)
})
