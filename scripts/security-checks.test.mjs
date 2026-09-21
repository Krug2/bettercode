import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const dns = require("node:dns").promises
const {
  isPrivateOrReservedIp,
  assertSafePublicHost,
  resolvePublicHostPinned,
} = require("../apps/shell/shared/security-checks.cjs")

test("public-host policy rejects alternate and scoped non-public IPv6 addresses", () => {
  for (const address of [
    "0:0:0:0:0:0:0:0",
    "0:0:0:0:0:0:0:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:8.8.8.8",
    "::127.0.0.1",
    "fc00::1",
    "fdff::1",
    "fe80::1",
    "fe81::1",
    "febf:ffff::1",
    "fe81::1%eth0",
    "fec0::1",
    "ff02::1",
    "FFFF::1",
    "2002:7f00:1::",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "100::1",
    "2001:2::1",
  ]) {
    assert.equal(isPrivateOrReservedIp(address), true, address)
  }
  for (const address of [
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "8.8.8.8",
  ]) {
    assert.equal(isPrivateOrReservedIp(address), false, address)
  }
})

test("both DNS guards reject every non-public answer and preserve public pinning", async (t) => {
  const lookup = t.mock.method(dns, "lookup", async () => [
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "0:0:0:0:0:ffff:7f00:1", family: 6 },
  ])
  for (const guard of [assertSafePublicHost, resolvePublicHostPinned]) {
    await assert.rejects(guard("skills.example"), /private\/reserved/)
  }

  const pinned = { address: "2606:4700:4700::1111", family: 6 }
  lookup.mock.mockImplementation(async () => [pinned])
  assert.deepEqual(await resolvePublicHostPinned("skills.example"), pinned)
  await assertSafePublicHost("skills.example")
})
