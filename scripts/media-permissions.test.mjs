import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const source = readFileSync(new URL("../apps/shell/main.cjs", import.meta.url), "utf8")
const start = source.indexOf("session.defaultSession.setPermissionRequestHandler(")
const end = source.indexOf("for (const partition of", start)
assert.ok(start >= 0 && end > start)

function handlers(isPackaged = false) {
  const policy = {
    isPackaged, devRendererOrigin: "http://localhost:49123",
    packagedRendererRoot: path.resolve("apps/ui/dist"), trustedWebContentsIds: new Set([1]),
  }
  const url = isPackaged ? pathToFileURL(path.join(policy.packagedRendererRoot, "index.html")).href : `${policy.devRendererOrigin}/`
  const contents = { id: 1, getURL: () => url, isDestroyed: () => false }
  const session = { defaultSession: {
    setPermissionRequestHandler: callback => { session.request = callback },
    setPermissionCheckHandler: callback => { session.check = callback },
  } }
  runInNewContext(source.slice(start, end), {
    session, getRendererSecurityPolicy: () => policy,
    ...require("../apps/shell/shared/urlPolicy.cjs"),
  })
  return { session, contents, details: { isMainFrame: true, requestingUrl: url, mediaTypes: ["audio"] } }
}

test("media requests admit only a registered app main frame requesting audio", () => {
  for (const packaged of [false, true]) {
    const { session, contents, details } = handlers(packaged)
    const request = (sender, permission, value) => {
      let result
      session.request(sender, permission, allowed => { result = allowed }, value)
      return result
    }
    assert.equal(request(contents, "media", details), true)
    for (const override of [{ isMainFrame: false }, { requestingUrl: "https://untrusted.example" }, { mediaTypes: ["video"] }, { mediaTypes: ["audio", "video"] }, { mediaTypes: [] }, { mediaTypes: undefined }]) {
      assert.equal(request(contents, "media", { ...details, ...override }), false)
    }
    assert.equal(request({ ...contents, id: 2 }, "media", details), false)
    assert.equal(request(null, "media", details), false)
    assert.equal(request(contents, "geolocation", details), false)
  }
})

test("permission checks apply the same microphone and frame boundary", () => {
  const { session, contents, details } = handlers()
  assert.equal(typeof session.check, "function")
  const check = value => session.check(contents, "media", "http://localhost:49123", { ...details, mediaTypes: undefined, ...value })
  assert.equal(check({ mediaType: "audio" }), true)
  for (const value of [{ mediaType: "video" }, { mediaType: "unknown" }, {}, { mediaType: "audio", isMainFrame: false }]) assert.equal(check(value), false)
  assert.equal(session.check(null, "media", "http://localhost:49123", { ...details, mediaType: "audio" }), false)
})
