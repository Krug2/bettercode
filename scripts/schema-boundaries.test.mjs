import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const {
  checkpointRefForThreadTurn, normalizeModelSlug, threadCheckpointRevertSchema,
  threadWorktreeRemoveSchema, threadWorktreeResetSchema,
} = require("@betterc0de/schema")

test("unknown model aliases remain strings even when they name prototype properties", () => {
  for (const provider of [undefined, "codex", "claude", "cursor", "betterc0de"]) {
    for (const model of ["constructor", "__proto__"]) {
      assert.equal(normalizeModelSlug(model, provider), model)
    }
  }
  assert.equal(normalizeModelSlug("5.4", "codex"), "gpt-5.4")
  assert.equal(normalizeModelSlug(" private-model ", "claude"), "private-model")
})

test("checkpoint refs reject turn numbers that cannot be represented exactly", () => {
  assert.throws(() => checkpointRefForThreadTurn("thread", Number.MAX_SAFE_INTEGER + 1), /turnCount/)
  assert.throws(() => checkpointRefForThreadTurn("thread", Infinity), /turnCount/)
  assert.equal(checkpointRefForThreadTurn("thread", Number.MAX_SAFE_INTEGER),
    "refs/betterc0de/checkpoints/dGhyZWFk/turn/9007199254740991")
})

test("destructive worktree flags require JSON booleans rather than truthy strings", () => {
  for (const [schema, base, flags] of [
    [threadWorktreeRemoveSchema, {}, ["deleteBranch", "force"]],
    [threadWorktreeResetSchema, {}, ["clean", "updateSubmodules"]],
    [threadCheckpointRevertSchema, { turnCount: 1 }, ["preserveFuture"]],
  ]) {
    for (const flag of flags) {
      assert.equal(schema.safeParse({ ...base, [flag]: "false" }).success, false)
      assert.equal(schema.parse({ ...base, [flag]: false })[flag], false)
      assert.equal(schema.parse({ ...base, [flag]: true })[flag], true)
    }
  }
  assert.deepEqual(threadWorktreeRemoveSchema.parse({}), { deleteBranch: false, force: true })
  assert.deepEqual(threadWorktreeResetSchema.parse({}), { clean: true, updateSubmodules: true })
})
