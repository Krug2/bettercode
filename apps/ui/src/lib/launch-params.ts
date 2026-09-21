/**
 * Per-window launch parameters carried in `window.location.hash`.
 *
 * The Electron main process spawns secondary BrowserWindows (via the
 * `windowOpenWith` IPC) with a hash like `#mode=editor&cwd=<encoded>`.
 * That window's renderer reads the hash exactly once at boot and applies
 * the overrides — `mode` switches `appMode`, `cwd` selects a matching
 * conversation or becomes the project for a new chat.
 *
 * The hash is preserved across reloads of the same window so devtools
 * F5 / hot-reload doesn't lose the workspace. The window's latest mode is
 * remembered in sessionStorage; localStorage supplies the default for a
 * fresh window without an explicit launch mode.
 */
export interface LaunchParams {
  mode?: "agent" | "editor" | "design"
  cwd?: string
}

let cached: LaunchParams | null = null
let windowMode: LaunchParams["mode"]
const WINDOW_MODE_KEY = "betterc0de-window-mode"

function isAppMode(value: unknown): value is NonNullable<LaunchParams["mode"]> {
  return value === "agent" || value === "editor" || value === "design"
}

function parseHash(hash: string): LaunchParams {
  const out: LaunchParams = {}
  if (!hash) return out
  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const m = params.get("mode")
  if (m === "editor" || m === "agent" || m === "design") out.mode = m
  const cwd = params.get("cwd")
  if (cwd && cwd.length > 0 && cwd.length <= 2048) out.cwd = cwd
  return out
}

/**
 * Returns the parsed launch params for THIS window. The result is
 * memoised on first call — subsequent reads don't re-parse the hash, so
 * the params are stable for the lifetime of the renderer.
 *
 * Server-side (vitest, ssr) returns `{}`.
 */
export function getLaunchParams(): LaunchParams {
  if (cached) return cached
  if (typeof window === "undefined") {
    cached = {}
    return cached
  }
  cached = parseHash(window.location?.hash ?? "")
  return cached
}

/** Mode belongs to a window; changing it must not switch its neighbours. */
export function getWindowAppMode(fallback: NonNullable<LaunchParams["mode"]>) {
  if (typeof window === "undefined") return fallback
  if (windowMode) return windowMode
  let stored: string | null = null
  try { stored = window.sessionStorage.getItem(WINDOW_MODE_KEY) } catch { /* Storage may be disabled. */ }
  const mode = isAppMode(stored) ? stored : getLaunchParams().mode ?? fallback
  setWindowAppMode(mode)
  return mode
}

export function setWindowAppMode(mode: NonNullable<LaunchParams["mode"]>): void {
  if (typeof window === "undefined") return
  windowMode = mode
  try { window.sessionStorage.setItem(WINDOW_MODE_KEY, mode) } catch { /* Keep the in-memory choice. */ }
}

/** Test-only: reset the memoised cache so a unit test can stub a new hash. */
export function _resetLaunchParamsCache(): void {
  cached = null
  windowMode = undefined
}
