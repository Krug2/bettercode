import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { validateDeviceView } = require("../apps/shell/device-windows.cjs")
const id = "a".repeat(64)
const host = `device-${id.slice(0, 32)}.localhost:4444`
const view = { hostId: id, label: "host", url: `http://${host}/#token=${"x".repeat(43)}` }

test("device windows only accept the selected host's local view", () => {
  assert.equal(validateDeviceView(view, id).host, host)
  for (const url of [
    view.url.replace(host, "example.com"), view.url.replace(host, "127.0.0.1:4444"),
    view.url.replace("http:", "https:"), view.url.replace("/#", "/path#"),
    view.url.replace("/#", "/?secret=value#"), view.url.replace("#token=", "#credential="),
    view.url.replace("http://", "http://user:password@"),
  ]) assert.throws(() => validateDeviceView({ ...view, url }, id), /Invalid device view/)
  assert.throws(() => validateDeviceView(view, "b".repeat(64)), /Invalid device view/)
})
