import assert from "node:assert/strict"
import fs from "node:fs"
import { runInNewContext } from "node:vm"
import { test } from "node:test"

function preload(workspace = false) {
  const sent = []
  const scripts = []
  const listeners = new Map()
  const ipcListeners = new Map()
  let bridge
  runInNewContext(fs.readFileSync(new URL("../apps/shell/browser-preview-preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "win32", argv: workspace ? ["--betterc0de-workspace-browser"] : [] },
    window: { addEventListener() {} },
    document: { addEventListener: (name, listener) => listeners.set(name, listener) },
    console,
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } },
      ipcRenderer: { on: (name, listener) => ipcListeners.set(name, listener), sendToHost: (...args) => sent.push(args) },
      webFrame: { executeJavaScript: async (script) => { scripts.push(script) } },
    }),
  })
  return { sent, scripts, listeners, bridge, ipcListeners }
}

test("page bridge cannot forge trusted keyboard notifications", () => {
  const { bridge, sent, listeners } = preload()
  bridge.send("keyboard-shortcut", { shortcut: "open-devtools" })
  bridge.send("did-keydown", { key: "F12" })
  assert.equal(sent.length, 0)
  bridge.send("element-selected", { selector: "#demo" })
  assert.equal(sent[0][0], "element-selected")
  listeners.get("keydown")({ isTrusted: true, key: "F12", preventDefault() {} })
  assert.equal(sent[1][0], "keyboard-shortcut")
  assert.equal(sent[1][1].shortcut, "open-devtools")
})

test("workspace browsing keeps editing and page dialogs native", () => {
  const { sent, scripts, listeners } = preload(true)
  assert.equal(scripts.length, 0)
  let prevented = 0
  for (const key of ["a", "c", "v", "x", "z"]) listeners.get("keydown")({ isTrusted: true, key, ctrlKey: true, preventDefault: () => prevented++ })
  assert.equal(prevented, 0)
  assert.equal(sent.length, 0)
  listeners.get("keydown")({ isTrusted: true, key: "l", ctrlKey: true, preventDefault: () => prevented++ })
  assert.equal(prevented, 1)
  assert.equal(sent[0][1].shortcut, "focus-url-bar")
})

test("only shell notifications can forward workspace popup links", () => {
  const { sent, bridge, ipcListeners } = preload(true)
  bridge.send("workspace-open-url", "https://example.com")
  assert.equal(sent.length, 0)
  ipcListeners.get("workspace-open-url")({}, "javascript:alert(1)")
  assert.equal(sent.length, 0)
  ipcListeners.get("workspace-open-url")({}, "https://example.com")
  assert.deepEqual(sent, [["workspace-open-url", "https://example.com"]])
})

test("dialog instrumentation bounds retained history while preserving prompt results", () => {
  const { scripts } = preload()
  const page = { console: { log() {} } }
  page.window = page
  runInNewContext(scripts.find(script => script.includes("__bcDialogOverridesApplied")), page)
  const large = "x".repeat(20_000)
  for (let index = 0; index < 1200; index += 1) page.alert(large)
  assert.ok(page.__bcGetDialogHistory().length <= 1000)
  assert.ok(page.__bcGetDialogHistory()[0].message.length <= 4096)
  assert.equal(page.prompt("question", large), large)
  const prompt = page.__bcGetDialogHistory().at(-1)
  assert.ok(prompt.defaultValue.length <= 4096)
  assert.ok(prompt.result.length <= 4096)
  assert.equal(page.confirm("confirm"), true)
  assert.equal(page.__bcGetDialogHistory().at(-1).result, true)
})
