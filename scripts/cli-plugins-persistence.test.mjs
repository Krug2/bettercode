import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { setCodexPluginEnabled } = require("../apps/shell/cli-plugins.cjs")

async function withCodexHome(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-plugin-write-"))
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = root
  try { await run(root) } finally {
    if (previous === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("plugin toggle uses private staging and preserves a recoverable prior config", () => withCodexHome(async (root) => {
  const target = path.join(root, "config.toml")
  const original = '# keep this\nmodel = "custom"\n[plugins."review@local"]\nenabled = false\n'
  fs.writeFileSync(target, original)
  fs.writeFileSync(`${target}.betterc0de-tmp`, "unowned file")
  await setCodexPluginEnabled("review@local", true)
  assert.equal(fs.readFileSync(`${target}.betterc0de-tmp`, "utf8"), "unowned file")
  assert.equal(fs.readFileSync(`${target}.bak`, "utf8"), original)
  assert.match(fs.readFileSync(target, "utf8"), /enabled = true/)
  assert.equal(fs.readdirSync(root).filter(name => name.includes(".tmp-")).length, 0)
}))

test("plugin toggle refuses an oversized source instead of rewriting it", () => withCodexHome(async (root) => {
  const target = path.join(root, "config.toml")
  fs.writeFileSync(target, 'model = "custom"\n')
  fs.truncateSync(target, 2 * 1024 * 1024)
  await assert.rejects(setCodexPluginEnabled("review@local", true), /oversized/)
  assert.equal(fs.statSync(target).size, 2 * 1024 * 1024)
  assert.deepEqual(fs.readdirSync(root), ["config.toml"])
}))
