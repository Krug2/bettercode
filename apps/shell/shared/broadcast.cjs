const { BrowserWindow } = require("electron")

/**
 * Send `payload` on `channel` to every alive BrowserWindow's webContents.
 *
 * Used by IPC senders (claude-ipc, plugin-ipc, backend status emitter)
 * that previously held a single hardcoded `mainWindow` reference and
 * silently dropped every event for any secondary window the user had
 * spawned via `WindowOpenWith` ("Open in Editor Mode" right-click).
 *
 * Behaviour notes:
 *  - Skips destroyed webContents — `BrowserWindow.getAllWindows()` only
 *    returns alive ones, but a window can be in the middle of closing
 *    when we iterate; the `isDestroyed()` check covers that race.
 *  - Wrapped in try/catch per-window so one dead listener can't take
 *    down the whole broadcast (e.g. if the renderer crashed mid-send).
 *  - Uses webContents.send which queues until the renderer is ready,
 *    so a freshly-spawned secondary window doesn't lose early frames.
 *
 * Renderer-side filtering: events typically carry a `threadId` /
 * `pluginId` / `requestId`; each renderer ignores frames it doesn't own.
 * Broadcasting indiscriminately is therefore safe — there is no
 * sensitive data leaked between windows that don't already share state
 * via localStorage / IndexedDB / the SQLite-backed thread DB.
 */
function broadcast(channel, payload) {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    try {
      if (win.isDestroyed()) continue
      const wc = win.webContents
      if (!wc || wc.isDestroyed()) continue
      wc.send(channel, payload)
    } catch (err) {
      // Best-effort — log once per broadcast so we don't spam the
      // console if one window's webContents persistently fails.
      console.warn(
        "[broadcast] send failed:",
        channel,
        err && err.message ? err.message : err,
      )
    }
  }
}

module.exports = { broadcast }
