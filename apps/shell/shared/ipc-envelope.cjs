/**
 * Shared envelope helpers for IPC handler returns.
 *
 * Every main-process handler used to hand-roll `{ ok: true, ... }` /
 * `{ ok: false, error: e.message }` — 60+ call sites across the
 * electron/*-ipc.cjs files. Centralizing normalizes the shape, hides
 * the `err.message ?? String(err)` fallback dance, and gives renderers
 * exactly one envelope to narrow on.
 *
 * Shape kept backward-compatible with the hand-rolled versions (same
 * `{ ok, error?, ... }` with spread of success data) so preload +
 * renderer code needn't change.
 */

/**
 * Success envelope. Any extra fields in `data` are spread onto the
 * result so existing callers that returned `{ ok: true, id }` /
 * `{ ok: true, manifest }` keep the same wire shape.
 */
function ok(data) {
  return data === undefined ? { ok: true } : { ok: true, ...data }
}

/**
 * Failure envelope. Accepts Error, string, or anything — coerces to a
 * human-readable `error` string. Extra `extras` keys are spread on
 * top, matching legacy code that returned defaults alongside the
 * error (e.g. the `cli:auto-sync` handler returns zeroed `imported`
 * counts on failure).
 */
function fail(err, extras) {
  const error =
    err instanceof Error
      ? err.message || err.name || "Error"
      : typeof err === "string"
        ? err
        : String(err)
  return extras ? { ok: false, error, ...extras } : { ok: false, error }
}

module.exports = { ok, fail }
