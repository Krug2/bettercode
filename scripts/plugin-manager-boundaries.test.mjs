import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"

const file = new URL("../apps/shell/plugin-manager.cjs", import.meta.url)
const require = createRequire(file)
const source = readFileSync(file, "utf8")
const runtimeSource = readFileSync(new URL("../apps/shell/shared/runtime-paths.cjs", import.meta.url), "utf8")

function load(isPackaged, env) {
  const app = { isPackaged, getPath: () => os.homedir() }
  const runtime = { exports: {} }
  const runtimeRequire = createRequire(new URL("../apps/shell/shared/runtime-paths.cjs", import.meta.url))
  runInNewContext(runtimeSource, {
    module: runtime, process: { env },
    require: name => name === "electron" ? { app } : runtimeRequire(name),
  })
  const module = { exports: {} }
  runInNewContext(source, {
    module, process: { env }, __dirname: path.dirname(fileURLToPath(file)),
    require: name => name === "electron" ? { app }
      : name === "./shared/runtime-paths.cjs" ? runtime.exports : require(name),
  })
  return new module.exports.PluginManager()
}

test("provider plugins follow the selected profile home", () => {
  const profile = path.join(os.tmpdir(), "bc0de-isolated-profile")
  for (const packaged of [true, false]) {
    assert.equal(load(packaged, { BETTERC0DE_HOME: profile }).pluginsDir, path.join(profile, "plugins"))
  }
})

test("plugin method dispatch refuses inherited object methods", async () => {
  const manager = load(false, {})
  manager._readConfig = () => ({ enabled: true, values: {} })
  manager.plugins.set("demo", { module: { ping: () => "pong" }, config: { apiKey: "private-value" } })
  await assert.rejects(manager.sendToPlugin("demo", "constructor", {}), /no method/)
  await assert.rejects(manager.sendToPlugin("demo", "toString", {}), /no method/)
  assert.equal(await manager.sendToPlugin("demo", "ping", {}), "pong")
})
