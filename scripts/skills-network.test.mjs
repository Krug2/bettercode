import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { skillsShSearch } = require("../apps/shell/skills-sh.cjs")

test("registry search rejects oversized and malformed response envelopes", async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ skills: [], padding: "x".repeat(1024 * 1024) }))
    await assert.rejects(skillsShSearch("review"), /exceeds/)
    globalThis.fetch = async () => new Response(JSON.stringify({ skills: "invalid" }))
    await assert.rejects(skillsShSearch("review"), /Invalid skills.sh/)
  } finally { globalThis.fetch = previous }
})

test("registry search keeps validated results and disallows redirects", async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.redirect, "error")
      assert.ok(init.signal instanceof AbortSignal)
      return new Response(JSON.stringify({ skills: [
        { source: "team/repo", skillId: "review", name: "Review", installs: 3 },
        { source: "--flag", skillId: "unsafe" },
      ] }))
    }
    assert.deepEqual(await skillsShSearch("review"), { skills: [
      { id: "team/repo/review", source: "team/repo", skillId: "review", name: "Review", installs: 3 },
    ] })
  } finally { globalThis.fetch = previous }
})
