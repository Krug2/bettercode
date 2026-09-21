/**
 * Plugin IPC — Electron IPC handlers for plugin system
 */

const { dialog, BrowserWindow, app } = require("electron")
const path = require("path")
const fs = require("fs")
const { PluginManager, validatePluginId } = require("./plugin-manager.cjs")
const { IpcChannel, IpcEvent } = require("./shared/ipc-contract.cjs")
const { safeHandle, rawHandle } = require("./shared/ipc-handlers-factory.cjs")
const { assertPathContained } = require("./shared/security-checks.cjs")
const { broadcast } = require("./shared/broadcast.cjs")

const manager = new PluginManager()

// Resolve "the window the user is interacting with" for dialog parents
// (`dialog.showOpenDialog`, `dialog.showMessageBox`). With multi-window
// support the previous "remembered mainWindow" hint became misleading —
// dialogs anchored to the wrong window when the user triggered an
// install from a secondary BrowserWindow. Letting Electron pick the
// focused window resolves this correctly in every case.
function getWindow() {
  return (
    BrowserWindow.getFocusedWindow() ||
    BrowserWindow.getAllWindows()[0] ||
    null
  )
}
let handlersRegistered = false

async function activateInstalledPlugin(manifest) {
  try {
    await manager.loadPlugin(manifest.id)
    await setupEvents(manifest.id)
  } catch (activationError) {
    try {
      await manager.togglePlugin(manifest.id, false)
    } catch (disableError) {
      throw new AggregateError(
        [activationError, disableError],
        `Plugin ${manifest.id} was installed, failed to activate, and could not be disabled`,
      )
    }
    throw new Error(
      `Plugin ${manifest.id} was installed but disabled because activation failed: ${
        activationError?.message || String(activationError)
      }`,
      { cause: activationError },
    )
  }
}

function getBundledPluginsDirectory() {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "apps",
        "shell",
        "default-plugins",
      )
    : path.join(__dirname, "default-plugins")
}

async function registerPluginHandlers() {
  if (handlersRegistered) return
  handlersRegistered = true

  rawHandle(IpcChannel.PluginList, async () => manager.listPlugins(), {
    fallback: [],
    warnTag: "plugin-ipc",
  })

  // Install plugin from folder.
  // SECURITY: any renderer-supplied `sourcePath` is treated as untrusted and
  // requires an explicit user confirmation dialog before we copy+require code
  // into the main process. When the caller omits `sourcePath`, the native
  // file-picker provides the approval implicitly.
  safeHandle(IpcChannel.PluginInstall, async (_event, { sourcePath } = {}) => {
    if (!sourcePath) {
      const result = await dialog.showOpenDialog(getWindow(), {
        properties: ["openDirectory"],
        title: "Select Plugin Folder",
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false }
      sourcePath = result.filePaths[0]
    } else {
      if (typeof sourcePath !== "string" || sourcePath.length === 0) {
        throw new Error("Invalid sourcePath")
      }
      const confirm = await dialog.showMessageBox(getWindow(), {
        type: "warning",
        title: "Install plugin?",
        message: "Install plugin from this folder?",
        detail:
          `${sourcePath}\n\n` +
          "Plugins execute native code in the BetterC0de main process. " +
          "Only install plugins from sources you trust.",
        buttons: ["Cancel", "Install"],
        defaultId: 0,
        cancelId: 0,
      })
      if (confirm.response !== 1) throw new Error("User cancelled")
    }
    const manifest = await manager.installPlugin(sourcePath)
    await activateInstalledPlugin(manifest)
    return { manifest }
  })

  safeHandle(IpcChannel.PluginRemove, async (_event, { pluginId } = {}) => {
    await manager.removePlugin(pluginId)
  })

  safeHandle(IpcChannel.PluginToggle, async (_event, { pluginId, enabled } = {}) => {
    await manager.togglePlugin(pluginId, enabled)
    if (enabled) {
      try {
        await manager.loadPlugin(pluginId)
        await setupEvents(pluginId)
      } catch (activationError) {
        try {
          await manager.togglePlugin(pluginId, false)
        } catch (disableError) {
          throw new AggregateError(
            [activationError, disableError],
            `Plugin ${pluginId} failed to activate and could not be disabled`,
          )
        }
        throw activationError
      }
    }
  })

  // Plugin config is a free-form object; renderer expects the raw object,
  // not the `{ok, ...}` envelope, so this stays on `rawHandle`.
  rawHandle(
    IpcChannel.PluginConfigGet,
    async (_event, { pluginId } = {}) => manager.getPublicConfig(pluginId),
    { fallback: {}, warnTag: "plugin-ipc" },
  )

  safeHandle(IpcChannel.PluginConfigSet, async (_event, { pluginId, key, value } = {}) => {
    await manager.setConfig(pluginId, key, value)
  })

  safeHandle(IpcChannel.PluginSend, async (_event, { pluginId, method, args } = {}) => {
    const result = await manager.sendToPlugin(pluginId, method, args)
    return { result }
  })

  // Install a specific default plugin by ID (for marketplace).
  safeHandle(IpcChannel.PluginInstallDefault, async (_event, { pluginId } = {}) => {
    validatePluginId(pluginId)
    // After the apps/ migration the shell lives at `apps/shell/` and its
    // default plugins at `apps/shell/default-plugins/`. The pre-migration
    // path `electron/default-plugins` no longer exists — using it in a
    // packaged build would surface as "Plugin not found in default plugins"
    // for every marketplace install.
    const resourcesDir = getBundledPluginsDirectory()
    if (!fs.existsSync(resourcesDir)) {
      throw new Error(
        "This build does not include a bundled plugin catalog. Install the plugin from a trusted folder instead.",
      )
    }

    // Resolve + contain via the shared helper. validatePluginId already
    // precludes traversal via the id format; this is the second line of
    // defence so the file system layer can't see a path escaping the
    // default-plugins root.
    const sourcePath = assertPathContained(resourcesDir, pluginId, "Plugin path")
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Plugin ${pluginId} not found in default plugins`)
    }

    const manifest = await manager.installPlugin(sourcePath)
    await activateInstalledPlugin(manifest)
    return { manifest }
  })

  // Load all enabled plugins on startup
  await manager.loadAllEnabled()

  // Setup event forwarding for loaded plugins
  for (const [id] of manager.plugins) {
    try {
      await setupEvents(id)
    } catch (err) {
      console.error(`[plugin-ipc] Failed to register events for ${id}:`, err)
    }
  }

  console.log("[plugin-ipc] Handlers registered")
}

async function setupEvents(pluginId) {
  // Plugin events used to be pinned to the (single) `mainWindow`; that
  // dropped events for secondary windows opened via `WindowOpenWith`.
  // Broadcasting reaches every renderer; each renderer's plugin-store
  // filters by `pluginId` so unrelated windows just discard the frame.
  await manager.setupPluginEvents(pluginId, (event) => {
    broadcast(IpcEvent.PluginEvent, event)
  })
}

/** Kept as a no-op for back-compat with `main.cjs` callers — plugin
 *  events now go through `broadcast()` and dialog parents come from
 *  `BrowserWindow.getFocusedWindow()`. Safe to delete in a future
 *  cleanup pass once no caller imports it. */
function setPluginWindow(_win) {
  // intentional no-op
}

async function installDefaultPlugins() {
  const result = await manager.installDefaults(getBundledPluginsDirectory())
  if (!result.available) {
    console.info(
      "[plugin] No bundled plugin catalog is included in this build; folder installs remain available.",
    )
  }
  return result
}

function setPluginEncryptionKey(base64Key) {
  manager.setEncryptionKey(base64Key)
}

async function disposePlugins() {
  await manager.disposeAll()
}

module.exports = {
  registerPluginHandlers,
  setPluginWindow,
  installDefaultPlugins,
  setPluginEncryptionKey,
  disposePlugins,
}
