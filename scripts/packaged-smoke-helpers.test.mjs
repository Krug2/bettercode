import test from "node:test"
import assert from "node:assert/strict"
import {
  parseDevToolsWebSocketUrl,
  removeDirectoryWithRetries,
  selectRendererTarget,
  validateRendererSnapshot,
} from "./packaged-smoke-helpers.mjs"

test("extracts the Chromium DevTools browser endpoint from diagnostics", () => {
  assert.equal(
    parseDevToolsWebSocketUrl(
      "noise\nDevTools listening on ws://127.0.0.1:43123/devtools/browser/abc-def\n"
    ),
    "ws://127.0.0.1:43123/devtools/browser/abc-def"
  )
})

test("selects a real renderer page instead of blank and DevTools targets", () => {
  const renderer = {
    id: "renderer",
    type: "page",
    title: "BetterC0de",
    url: "file:///app/apps/ui/dist/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:43123/devtools/page/renderer",
  }
  assert.deepEqual(
    selectRendererTarget([
      {
        id: "blank",
        type: "page",
        title: "",
        url: "about:blank",
        webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/blank",
      },
      { id: "devtools", type: "other", title: "DevTools", url: "devtools://" },
      {
        id: "preview",
        type: "page",
        title: "Preview",
        url: "https://example.test/",
        webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/preview",
      },
      renderer,
    ]),
    renderer
  )
})

test("requires the BetterC0de document and a mounted React root", () => {
  assert.deepEqual(
    validateRendererSnapshot({
      readyState: "complete",
      title: "BetterC0de",
      url: "file:///app/apps/ui/dist/index.html",
      rootChildCount: 1,
    }),
    { ok: true }
  )
  assert.match(
    validateRendererSnapshot({
      readyState: "complete",
      title: "BetterC0de",
      url: "file:///app/apps/ui/dist/index.html",
      rootChildCount: 0,
    }).reason,
    /root/i
  )
  assert.match(
    validateRendererSnapshot({
      readyState: "complete",
      title: "Error",
      url: "chrome-error://chromewebdata/",
      rootChildCount: 1,
    }).reason,
    /error page/i
  )
})

test("retries transient Windows directory removal failures with a bound", async () => {
  const attempts = []
  const waits = []

  await removeDirectoryWithRetries("temporary-smoke-profile", {
    maxAttempts: 4,
    retryDelayMs: 25,
    remove: async (directory) => {
      attempts.push(directory)
      if (attempts.length < 3) {
        throw Object.assign(new Error("directory is still locked"), {
          code: "EBUSY",
        })
      }
    },
    wait: async (ms) => {
      waits.push(ms)
    },
  })

  assert.deepEqual(attempts, [
    "temporary-smoke-profile",
    "temporary-smoke-profile",
    "temporary-smoke-profile",
  ])
  assert.deepEqual(waits, [25, 50])
})

test("preserves terminal directory removal failures", async () => {
  const persistentBusy = Object.assign(new Error("directory stayed locked"), {
    code: "EBUSY",
  })
  let attempts = 0

  await assert.rejects(
    removeDirectoryWithRetries("temporary-smoke-profile", {
      maxAttempts: 3,
      retryDelayMs: 0,
      remove: async () => {
        attempts += 1
        throw persistentBusy
      },
      wait: async () => {},
    }),
    persistentBusy
  )
  assert.equal(attempts, 3)

  const permissionFailure = Object.assign(new Error("access denied"), {
    code: "EACCES",
  })
  attempts = 0
  await assert.rejects(
    removeDirectoryWithRetries("temporary-smoke-profile", {
      remove: async () => {
        attempts += 1
        throw permissionFailure
      },
      wait: async () => {
        assert.fail("non-retryable failures must not wait")
      },
    }),
    permissionFailure
  )
  assert.equal(attempts, 1)
})
