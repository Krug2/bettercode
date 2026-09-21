import assert from "node:assert/strict"
import fs from "node:fs"
import { runInNewContext } from "node:vm"
import { test } from "node:test"

function inventory() {
  const source = fs.readFileSync(new URL("../apps/shell/cli-plugins.cjs", import.meta.url), "utf8")
  const begin = source.indexOf("let inventoryCache = null")
  const end = source.indexOf("const CLI_PLUGIN_ID_PATTERN", begin)
  assert.ok(begin >= 0 && end > begin)
  const pending = []
  const api = runInNewContext(`${source.slice(begin, end)}; ({ getCliPluginInventory, invalidateCliPluginInventory })`, {
    INVENTORY_CACHE_TTL_MS: 30_000,
    defaultRunCli() {},
    collectClaudeInventory: async () => ({}),
    collectCodexInventory: () => new Promise(resolve => pending.push(resolve)),
  })
  return { ...api, pending }
}

test("older forced inventory completion cannot replace the latest cache", async () => {
  const api = inventory()
  const first = api.getCliPluginInventory({ force: true })
  const second = api.getCliPluginInventory({ force: true })
  api.pending[1]({ version: "new" })
  await second
  api.pending[0]({ version: "old" })
  await first
  assert.equal((await api.getCliPluginInventory()).codex.version, "new")
})

test("invalidation retires a pending scan and preserves a newer in-flight owner", async () => {
  const api = inventory()
  const first = api.getCliPluginInventory()
  api.invalidateCliPluginInventory()
  const second = api.getCliPluginInventory()
  assert.equal(api.pending.length, 2)
  api.pending[0]({ version: "old" })
  await first
  const third = api.getCliPluginInventory()
  assert.equal(api.pending.length, 2)
  api.pending[1]({ version: "new" })
  assert.equal((await second).codex.version, "new")
  assert.equal((await third).codex.version, "new")
})
