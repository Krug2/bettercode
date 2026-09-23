const { BrowserWindow, shell } = require("electron")

function validateDeviceView(value, id) {
  if (!value || value.hostId !== id || typeof value.label !== "string" || value.label.length > 80) throw new Error("Invalid device view")
  const url = new URL(value.url)
  if (url.protocol !== "http:" || url.hostname !== `device-${id.slice(0, 32)}.localhost` || !url.port
    || url.username || url.password || url.pathname !== "/" || url.search || !/^#token=[\w-]{43}$/.test(url.hash))
    throw new Error("Invalid device view address")
  return url
}

function createDeviceWindows({ getBackendConnection }) {
  const windows = new Map()
  const opening = new Map()
  const open = async id => {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid device")
    if (opening.has(id)) return opening.get(id)
    const operation = (async () => {
      const backend = getBackendConnection()
      if (!backend) throw new Error("The local backend is unavailable")
      const response = await fetch(`http://127.0.0.1:${backend.port}/api/v1/devices/hosts/${id}/view`, {
        method: "POST", headers: { Authorization: `Bearer ${backend.token}` }, redirect: "error", signal: AbortSignal.timeout(45_000),
      })
      const view = await response.json()
      if (!response.ok) throw new Error(typeof view?.error === "string" ? view.error : "Could not open this device")
      const url = validateDeviceView(view, id)
      if (getBackendConnection()?.port !== backend.port) throw new Error("The local backend restarted; open the device again")
      let win = windows.get(id)
      if (!win || win.isDestroyed()) {
        win = new BrowserWindow({
          width: 1280, height: 850, minWidth: 640, minHeight: 480, title: `${view.label} · betterc0de`,
          autoHideMenuBar: true, show: false,
          webPreferences: {
            partition: `bettercode-device-${id}`, sandbox: true, contextIsolation: true, nodeIntegration: false,
            webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
          },
        })
        windows.set(id, win)
        const contents = win.webContents
        contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
        contents.session.setPermissionCheckHandler(() => false)
        contents.setWindowOpenHandler(({ url: target }) => {
          try { if (["https:", "http:"].includes(new URL(target).protocol)) void shell.openExternal(target) } catch {}
          return { action: "deny" }
        })
        const guard = (event, target) => {
          try { if (new URL(target).origin === url.origin) return } catch {}
          event.preventDefault()
        }
        contents.on("will-navigate", guard)
        contents.on("will-redirect", guard)
        contents.on("will-attach-webview", event => event.preventDefault())
        contents.on("page-title-updated", event => event.preventDefault())
        win.once("closed", () => windows.delete(id))
      }
      await win.loadURL(url.href)
      if (!win.isDestroyed()) { win.show(); win.focus() }
      return { ok: true }
    })().finally(() => opening.delete(id))
    opening.set(id, operation)
    return operation
  }
  return { open, closeAll() { for (const win of windows.values()) if (!win.isDestroyed()) win.destroy(); windows.clear() } }
}

module.exports = { createDeviceWindows, validateDeviceView }
