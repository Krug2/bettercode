/**
 * IPC handler factory — wraps the boilerplate try/catch + ok/fail envelope
 * that every shell/*-ipc.cjs file used to hand-roll. ~6 modules each had
 * 4–7 handlers wrapping the same pattern; centralizing removes ~150 LoC of
 * `try { ... return ok({...}) } catch (e) { return fail(e) }` repetition.
 *
 * `assertTrustedIpcSender` is already applied automatically by the
 * `ipcMain.handle` wrapper in `apps/shell/main.cjs`, so neither
 * helper here needs to add it. The factory only owns the post-call envelope.
 *
 * The pure `makeSafeWrapper` / `makeRawWrapper` functions are exported so
 * unit tests can exercise the envelope behavior without mocking the
 * electron module.
 */

const { ipcMain } = require("electron")
const { ok, fail } = require("./ipc-envelope.cjs")

/**
 * Wrap a user-provided handler so its result is normalized to the standard
 * `{ok, error?, ...}` envelope:
 *  - handler returns `undefined`        → `{ok: true}`
 *  - handler returns plain object       → `{ok: true, ...obj}`
 *  - handler returns object with `ok`   → passed through unchanged (lets
 *                                          callers signal `{ok: false, ...}`
 *                                          for non-throw failures)
 *  - handler throws                     → `{ok: false, error}` via `fail`
 */
function makeSafeWrapper(handler) {
  return async (event, ...args) => {
    try {
      const result = await handler(event, ...args)
      if (result && typeof result === "object" && !Array.isArray(result) && "ok" in result) {
        return result
      }
      return ok(result)
    } catch (e) {
      return fail(e)
    }
  }
}

/**
 * Wrap a handler that returns a raw value (array, scalar, plain object).
 * On error, returns `fallback` rather than an envelope; this matches the
 * legacy "list returns []" semantic used by *List handlers across hooks /
 * skills / subagents / mcp.
 */
function makeRawWrapper(handler, opts = {}) {
  const { fallback = null, warnTag, channel } = opts
  return async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      if (warnTag) {
        const tag = channel ? `${warnTag}] ${channel}` : warnTag
        console.warn(`[${tag} handler threw:`, err?.message || err)
      }
      return fallback
    }
  }
}

/** Register a `safeHandle`-wrapped IPC handler under `channel`. */
function safeHandle(channel, handler) {
  ipcMain.handle(channel, makeSafeWrapper(handler))
}

/** Register a `rawHandle`-wrapped IPC handler under `channel`. */
function rawHandle(channel, handler, opts = {}) {
  ipcMain.handle(channel, makeRawWrapper(handler, { ...opts, channel }))
}

module.exports = {
  safeHandle,
  rawHandle,
  makeSafeWrapper,
  makeRawWrapper,
}
