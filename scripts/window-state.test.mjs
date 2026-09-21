import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const helperSource = fs.readFileSync(new URL("../apps/shell/shared/json-fs.cjs", import.meta.url), "utf8")
const source = fs.readFileSync(new URL("../apps/shell/main.cjs", import.meta.url), "utf8")
const begin = source.indexOf("function loadWindowState()")
const end = source.indexOf("let windowStateSaveTimer", begin)
assert.ok(begin >= 0 && end > begin)

function helper(overrides = {}) {
  const module = { exports: {} }
  runInNewContext(helperSource, { module, Buffer, process, console,
    require: name => overrides[name] ?? require(name),
  })
  return module.exports
}

function windowState(directory, helpers = helper()) {
  return runInNewContext(`${source.slice(begin, end)}; ({ loadWindowState, writeWindowState })`, {
    path, WINDOW_STATE_FILENAME: "window-state.json",
    appConfig: { DEFAULT_WINDOW_WIDTH: 1400, DEFAULT_WINDOW_HEIGHT: 900 },
    resolveBetterC0deUserDataDir: () => directory, console: { warn() {} },
    require: name => name === "./shared/json-fs.cjs" ? helpers
      : name === "electron" ? { screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] } }
        : require(name),
  })
}

test("JSON staging collision never removes an unowned file", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-json-stage-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const destination = path.join(directory, "profile.json")
  const staged = path.join(directory, ".profile.json.reserved.tmp")
  fs.writeFileSync(staged, "unowned")
  const json = helper({ crypto: { randomUUID: () => "reserved" } })
  assert.throws(() => json.writeJson(destination, {}), /EEXIST/)
  assert.equal(fs.readFileSync(staged, "utf8"), "unowned")
})

test("window state refuses oversized files and invalid native bounds", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-window-state-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const state = windowState(directory)
  const file = path.join(directory, "window-state.json")
  for (const width of [2147483648, 800.5]) {
    fs.writeFileSync(file, JSON.stringify({ width, height: 600 }))
    assert.equal(state.loadWindowState().width, 1400)
  }
  fs.writeFileSync(file, JSON.stringify({ width: 800, height: 600 }) + " ".repeat(128 * 1024))
  assert.equal(state.loadWindowState().width, 1400)
  fs.writeFileSync(file, JSON.stringify({ width: 800, height: 600, x: 10, y: 20, isMaximized: "false" }))
  const valid = state.loadWindowState()
  assert.equal(valid.width, 800)
  assert.equal(valid.x, 10)
  assert.equal(valid.isMaximized, false)
})

test("failed window state replacement preserves the previous snapshot", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-window-state-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "window-state.json")
  fs.writeFileSync(file, JSON.stringify({ width: 800, height: 600 }))
  const state = windowState(directory, helper({ fs: { ...fs, renameSync: () => { throw new Error("fixture replacement denied") } } }))
  state.writeWindowState({ width: 900, height: 700 })
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).width, 800)
  assert.deepEqual(fs.readdirSync(directory), ["window-state.json"])
})
