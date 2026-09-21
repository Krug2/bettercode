import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { createArrayPersistAdapter } = require("../apps/shell/shared/persist-adapter.cjs")

test("saving after a parse failure preserves the original bytes for recovery", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persist-recovery-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "items.json")
  const broken = '[{"id":"existing","name":"unfinished'
  fs.writeFileSync(file, broken)
  const store = createArrayPersistAdapter({ filePath: () => file })
  assert.deepEqual(store.list(), [])
  store.save({ id: "new" })
  const backups = fs.readdirSync(directory).filter((name) => name.startsWith("items.json.corrupt-"))
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(directory, backups[0]), "utf8"), broken)
  assert.equal(store.list()[0].id, "new")
  store.save({ id: "second" })
  assert.equal(fs.readdirSync(directory).length, 2)
})

test("replacing an unreadable or oversized collection cannot discard it", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persist-recovery-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "items.json")
  const original = JSON.stringify([{ id: "existing", content: "x".repeat(128) }])
  fs.writeFileSync(file, original)
  const store = createArrayPersistAdapter({ filePath: () => file, maxBytes: 64 })
  assert.throws(() => store.replaceAll([]), /oversized/)
  assert.equal(fs.readFileSync(file, "utf8"), original)
})

test("invalid replacements and malformed entity identities cannot alter a valid collection", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persist-shape-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "items.json")
  const original = JSON.stringify([{ id: "existing" }])
  const store = createArrayPersistAdapter({ filePath: () => file })
  for (const invalid of [null, {}, [null], [42], [{}], [{ id: 42 }], [{ id: "" }], [{ id: "a" }, { id: "a" }]]) {
    fs.writeFileSync(file, original)
    assert.throws(() => store.replaceAll(invalid), /collection|entity|identity/i)
    assert.equal(fs.readFileSync(file, "utf8"), original)
  }
})

test("malformed persisted rows fail explicitly without being overwritten", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persist-shape-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "items.json")
  const store = createArrayPersistAdapter({ filePath: () => file })
  for (const value of [[null], [{ id: 42 }], [{ id: "a" }, { id: "a" }]]) {
    const original = JSON.stringify(value)
    fs.writeFileSync(file, original)
    assert.throws(() => store.list(), /entity|identity/i)
    assert.throws(() => store.save({ id: "new" }), /entity|identity/i)
    assert.equal(fs.readFileSync(file, "utf8"), original)
  }
})
