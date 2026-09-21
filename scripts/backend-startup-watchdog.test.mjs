import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const {
  createBackendStartupWatchdog,
} = require("../apps/shell/shared/backend-startup-watchdog.cjs")

function fakeTimers() {
  const handles = []
  return {
    handles,
    api: {
      setTimeout(callback, delay) {
        const handle = {
          callback,
          delay,
          cleared: false,
          unref() {},
        }
        handles.push(handle)
        return handle
      },
      clearTimeout(handle) {
        handle.cleared = true
      },
    },
    fire(handle) {
      if (!handle.cleared) handle.callback()
    },
  }
}

test("backend startup heartbeat extends only the idle deadline", () => {
  const timers = fakeTimers()
  const expirations = []
  const watchdog = createBackendStartupWatchdog({
    idleTimeoutMs: 30_000,
    hardTimeoutMs: 300_000,
    onTimeout: (expiration) => expirations.push(expiration),
    timerApi: timers.api,
  })

  const hardTimer = timers.handles[0]
  const firstIdleTimer = timers.handles[1]
  assert.equal(watchdog.pulse(), true)
  const secondIdleTimer = timers.handles[2]

  assert.equal(firstIdleTimer.cleared, true)
  assert.equal(hardTimer.cleared, false)
  timers.fire(firstIdleTimer)
  assert.deepEqual(expirations, [])

  timers.fire(secondIdleTimer)
  assert.deepEqual(expirations, [{ kind: "idle", timeoutMs: 30_000 }])
  assert.equal(hardTimer.cleared, true)
  assert.equal(watchdog.pulse(), false)
})

test("backend startup hard deadline remains absolute across heartbeats", () => {
  const timers = fakeTimers()
  const expirations = []
  const watchdog = createBackendStartupWatchdog({
    idleTimeoutMs: 30_000,
    hardTimeoutMs: 300_000,
    onTimeout: (expiration) => expirations.push(expiration),
    timerApi: timers.api,
  })

  const hardTimer = timers.handles[0]
  watchdog.pulse()
  watchdog.pulse()
  timers.fire(hardTimer)

  assert.deepEqual(expirations, [{ kind: "hard", timeoutMs: 300_000 }])
  assert.equal(
    timers.handles
      .filter((handle) => handle !== hardTimer)
      .every((handle) => handle.cleared),
    true,
  )
})

test("stopping the backend startup watchdog cancels every deadline", () => {
  const timers = fakeTimers()
  let expired = false
  const watchdog = createBackendStartupWatchdog({
    idleTimeoutMs: 30_000,
    hardTimeoutMs: 300_000,
    onTimeout: () => {
      expired = true
    },
    timerApi: timers.api,
  })

  watchdog.stop()
  for (const handle of timers.handles) timers.fire(handle)

  assert.equal(expired, false)
  assert.equal(watchdog.pulse(), false)
})
