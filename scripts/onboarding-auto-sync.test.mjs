import assert from "node:assert/strict"
import fs from "node:fs"
import { runInNewContext } from "node:vm"
import { test } from "node:test"

test("auto-sync deduplicates new MCP identities and transports within the same scan", async () => {
  const source = fs.readFileSync(new URL("../apps/shell/onboarding-ipc.cjs", import.meta.url), "utf8")
  const begin = source.indexOf("async function cliAutoSync(")
  const end = source.indexOf("let registered = false", begin)
  assert.ok(begin >= 0 && end > begin)
  let persisted
  const sync = runInNewContext(`${source.slice(begin, end)}; cliAutoSync`, {
    scanCliAssets: () => ({
      claude: { mcpServers: [{ id: "same-id", command: "node", args: ["one"] }] },
      codex: { mcpServers: [
        { id: "same-id", command: "node", args: ["two"] },
        { id: "other-name", command: "node", args: ["one"] },
        { id: "unique", command: "node", args: ["three"] },
      ] },
      projectScope: {},
    }),
    readMcps: () => [],
    writeMcps: (entries) => { persisted = entries },
    normalizeMcpConfig: (entry) => entry,
    slugify: (value) => value,
    listSkillDirs: () => [],
    listSubagentDirs: () => [],
  })
  const result = await sync()
  assert.deepEqual(Array.from(persisted, entry => entry.id), ["same-id", "unique"])
  assert.equal(result.imported.mcpServers, 2)
})
