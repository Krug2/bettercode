import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Hono } from "hono"
import type { ServerConfig } from "../config"
import { registerRemoteWebRoutes } from "./web"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-remote-web-"))
  )
  directories.push(root)
  fs.mkdirSync(path.join(root, "assets"))
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<html><head></head><body>app</body></html>"
  )
  fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log('app')")
  const app = new Hono()
  registerRemoteWebRoutes(
    app,
    { host: "0.0.0.0", port: 4773 } as ServerConfig,
    root
  )
  return app
}

describe("remote web host", () => {
  it("serves the SPA with same-origin runtime configuration", async () => {
    const response = await fixture().request("/")
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(html).toContain('"mode":"remote_http"')
    expect(html).toContain("baseUrl:window.location.origin")
  })

  it("uses immutable asset caching, SPA fallback, and real missing-asset 404s", async () => {
    const app = fixture()
    const asset = await app.request("/assets/app.js")
    expect(asset.status).toBe(200)
    expect(asset.headers.get("content-type")).toContain("text/javascript")
    expect(asset.headers.get("cache-control")).toContain("immutable")
    expect(asset.headers.get("content-length")).toBe(
      String(Buffer.byteLength("console.log('app')"))
    )
    expect(await asset.text()).toBe("console.log('app')")

    const navigation = await app.request("/chat/thread-1")
    expect(navigation.status).toBe(200)
    expect(await navigation.text()).toContain("baseUrl:window.location.origin")

    expect((await app.request("/assets/missing.js")).status).toBe(404)
  })
})
