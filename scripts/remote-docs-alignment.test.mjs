import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")
const docs = fs.readFileSync(path.join(root, "docs", "remote-access.md"), "utf8")
const config = fs.readFileSync(
  path.join(root, "apps", "backend", "src", "config.ts"),
  "utf8"
)
const remoteHttp = fs.readFileSync(
  path.join(root, "apps", "backend", "src", "remote", "http.ts"),
  "utf8"
)
const remoteService = fs.readFileSync(
  path.join(root, "apps", "backend", "src", "remote", "service.ts"),
  "utf8"
)

test("remote-access docs match shipped pairing, TTL, and access level", () => {
  assert.match(config, /BETTERC0DE_ALLOW_INSECURE_REMOTE_ACCESS/)
  assert.match(remoteHttp, /INSECURE_REMOTE_SESSION_TTL_MS = 60 \* 60 \* 1000/)
  assert.match(remoteHttp, /accessLevel: "read_only"/)
  assert.match(remoteService, /DEFAULT_SESSION_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000/)
  assert.doesNotMatch(docs, /180-day/)
  assert.match(docs, /30 days/)
  assert.match(docs, /read-only/)
  assert.match(docs, /BETTERC0DE_ALLOW_INSECURE_REMOTE_ACCESS/)
  assert.match(docs, /not a second full host/)
})
