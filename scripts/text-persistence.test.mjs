import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const file = new URL("../apps/shell/shared/json-fs.cjs", import.meta.url)
const { readText, writeText } = require("../apps/shell/shared/json-fs.cjs")

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "text-persistence-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, "rules.md")
}

test("text reads enforce the file byte limit before reading content", (t) => {
  const target = fixture(t)
  fs.writeFileSync(target, "original rules")
  assert.equal(readText(target, "unavailable", { maxBytes: 4 }), "unavailable")
  assert.equal(readText(target), "original rules")
})

test("failed text replacement preserves the previous rules and cleans owned staging", (t) => {
  const target = fixture(t)
  fs.writeFileSync(target, "previous rules")
  const module = { exports: {} }
  runInNewContext(fs.readFileSync(file, "utf8"), {
    module, Buffer, process, console,
    require: (name) => name === "fs" ? { ...fs, renameSync() { throw new Error("rename refused") } } : require(name),
  })
  assert.throws(() => module.exports.writeText(target, "replacement rules"), /rename refused/)
  assert.equal(fs.readFileSync(target, "utf8"), "previous rules")
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ["rules.md"])
})

test("oversized UTF-8 text writes cannot truncate existing content", (t) => {
  const target = fixture(t)
  fs.writeFileSync(target, "previous")
  assert.throws(() => writeText(target, "\u{1f680}".repeat(3), { maxBytes: 8 }), /exceeds/i)
  assert.equal(fs.readFileSync(target, "utf8"), "previous")
})
