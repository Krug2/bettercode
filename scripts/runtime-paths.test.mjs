import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const require = createRequire(new URL("../apps/shell/shared/runtime-paths.cjs", import.meta.url))
const source = readFileSync(new URL("../apps/shell/shared/runtime-paths.cjs", import.meta.url), "utf8")

function load(isPackaged, env = {}) {
  const module = { exports: {} }
  runInNewContext(source, {
    module, process: { env },
    require: (name) => name === "electron" ? { app: { isPackaged }, BrowserWindow: {} } : require(name),
  })
  return module.exports
}

test("runtime files and onboarding follow an explicitly selected profile home", () => {
  const profile = path.join(os.tmpdir(), "betterc0de-profile")
  for (const packaged of [false, true]) {
    const runtime = load(packaged, { BETTERC0DE_HOME: ` ${profile} ` })
    assert.equal(runtime.getBaseDir(), profile)
    assert.equal(runtime.getRuntimePaths().mcpFile, path.join(profile, "mcp-servers.json"))
    assert.equal(runtime.getRuntimePaths().rulesFile, path.join(profile, "rules.md"))
    assert.equal(runtime.getDoneFlag(), path.join(profile, "onboarding-done"))
  }
})

test("default profile isolation is retained and invalid overrides fail", () => {
  assert.equal(load(false).getBaseDir(), path.join(os.homedir(), ".betterc0de-dev"))
  assert.equal(load(true).getBaseDir(), path.join(os.homedir(), ".betterc0de"))
  for (const value of ["relative-profile", `${os.tmpdir()}\0bad`]) {
    assert.throws(() => load(false, { BETTERC0DE_HOME: value }).getBaseDir(), /absolute filesystem path/)
  }
})
