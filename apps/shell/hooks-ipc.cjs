/**
 * Hooks IPC — user-defined shell commands that fire on chat events.
 * Storage is a single JSON array at `hooks.json` alongside the other
 * per-user config files.
 */

const { IpcChannel } = require("./shared/ipc-contract.cjs")
const { safeHandle, rawHandle } = require("./shared/ipc-handlers-factory.cjs")
const { createArrayPersistAdapter } = require("./shared/persist-adapter.cjs")
const { getRuntimePaths } = require("./shared/runtime-paths.cjs")

const hooksStore = createArrayPersistAdapter({
  filePath: () => getRuntimePaths().hooksFile,
  warnTag: "hooks-ipc",
  buildEntry: (hook, existing, { now, id }) => ({
    id,
    event: hook.event,
    command: hook.command || "",
    enabled: hook.enabled !== false,
    createdAt: hook.createdAt || existing?.createdAt || now,
    updatedAt: now,
    lastRunAt: hook.lastRunAt || existing?.lastRunAt || null,
    lastStatus: hook.lastStatus || existing?.lastStatus || "idle",
    lastExitCode: hook.lastExitCode ?? existing?.lastExitCode ?? null,
    lastError: hook.lastError ?? existing?.lastError ?? null,
  }),
})

let registered = false

function registerHooksHandlers() {
  if (registered) return
  registered = true

  rawHandle(IpcChannel.HookList, async () => hooksStore.list(), {
    fallback: [],
    warnTag: "hooks-ipc",
  })

  safeHandle(IpcChannel.HookSave, async (_event, hook) => {
    const entry = hooksStore.save(hook || {})
    return { id: entry.id }
  })

  safeHandle(IpcChannel.HookDelete, async (_event, { id } = {}) => {
    hooksStore.remove(id)
  })

  safeHandle(
    IpcChannel.HookUpdateRun,
    async (_event, { id, status, exitCode, error } = {}) => {
      hooksStore.update(id, (hook) => ({
        ...hook,
        lastRunAt: new Date().toISOString(),
        lastStatus: status || hook.lastStatus || "idle",
        lastExitCode: exitCode ?? hook.lastExitCode ?? null,
        lastError: error ?? null,
      }))
    },
  )

  console.log("[hooks-ipc] Handlers registered")
}

module.exports = {
  registerHooksHandlers,
  // Back-compat exports for any callers outside this module that read or
  // overwrite the hooks list directly.
  readHooks: () => hooksStore.list(),
  writeHooks: (hooks) => hooksStore.replaceAll(hooks),
}
