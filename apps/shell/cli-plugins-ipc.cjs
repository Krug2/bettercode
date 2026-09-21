/**
 * IPC surface for the CLI-plugin inventory + mutations (Claude Code and
 * Codex plugins). Namespaced `cliPlugin:*` to stay clear of the `plugin:*`
 * channels that belong to BetterC0de's own provider-plugin system.
 *
 * Mutations are confirmed IN-APP by the renderer (ConfirmActionDialog in
 * marketplace-cli-plugins-tab.tsx) before the IPC call — the previous
 * native `dialog.showMessageBox` gate was replaced on user request.
 * Argument validation stays here as the last line of defense.
 */

const { IpcChannel } = require("./shared/ipc-contract.cjs")
const { safeHandle, rawHandle } = require("./shared/ipc-handlers-factory.cjs")
const {
  getCliPluginInventory,
  getAvailableCliPlugins,
  setClaudePluginEnabled,
  claudePluginInstall,
  claudePluginUninstall,
  codexPluginAdd,
  codexPluginRemove,
  setCodexPluginEnabled,
  validateCliPluginId,
} = require("./cli-plugins.cjs")

const EMPTY_INVENTORY = Object.freeze({
  claude: { cliDetected: false, plugins: [] },
  codex: { cliDetected: false, plugins: [] },
  scannedAt: 0,
})

function validateSource(source) {
  if (source !== "claude" && source !== "codex") {
    throw new Error(`Unknown CLI plugin source: ${source}`)
  }
  return source
}

let registered = false

function registerCliPluginHandlers() {
  if (registered) return
  registered = true

  rawHandle(
    IpcChannel.CliPluginInventory,
    async (_event, { force } = {}) =>
      getCliPluginInventory({ force: force === true }),
    { fallback: EMPTY_INVENTORY, warnTag: "cli-plugins-ipc" }
  )

  rawHandle(
    IpcChannel.CliPluginAvailable,
    async () => getAvailableCliPlugins(),
    { fallback: { claude: [], codex: [] }, warnTag: "cli-plugins-ipc" }
  )

  safeHandle(
    IpcChannel.CliPluginToggle,
    async (_event, { source, id, enabled } = {}) => {
      const cli = validateSource(source)
      const pluginId = validateCliPluginId(id)
      const nextEnabled = enabled === true
      if (cli === "claude") {
        await setClaudePluginEnabled(pluginId, nextEnabled)
      } else {
        await setCodexPluginEnabled(pluginId, nextEnabled)
      }
      return { inventory: await getCliPluginInventory({ force: true }) }
    }
  )

  safeHandle(
    IpcChannel.CliPluginInstall,
    async (_event, { source, id } = {}) => {
      const cli = validateSource(source)
      const pluginId = validateCliPluginId(id)
      if (cli === "claude") {
        await claudePluginInstall(pluginId)
      } else {
        await codexPluginAdd(pluginId)
      }
      return { inventory: await getCliPluginInventory({ force: true }) }
    }
  )

  safeHandle(
    IpcChannel.CliPluginUninstall,
    async (_event, { source, id } = {}) => {
      const cli = validateSource(source)
      const pluginId = validateCliPluginId(id)
      if (cli === "claude") {
        await claudePluginUninstall(pluginId)
      } else {
        await codexPluginRemove(pluginId)
      }
      return { inventory: await getCliPluginInventory({ force: true }) }
    }
  )

  console.log("[cli-plugins-ipc] Handlers registered")
}

module.exports = { registerCliPluginHandlers }
