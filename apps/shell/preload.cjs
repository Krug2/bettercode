const { contextBridge, ipcRenderer } = require("electron");

// NOTE: Electron's sandboxed preload environment restricts `require()` to
// `electron` + a tiny set of built-ins — it cannot load sibling `.cjs`
// modules like `./shared/ipc-contract.cjs`. So the channel strings live
// inline here. The authoritative registry is `apps/shell/shared/ipc-contract.{ts,cjs}`
// and `apps/ui/src/types/ipc-contract.parity.test.ts` enforces that those two stay
// in sync; this file is a third consumer that must be hand-aligned with the
// registry (rename a channel in ipc-contract + here at the same time).

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  // App info (async - call once and cache)
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  sendBugReport: (report) => ipcRenderer.invoke("bug-report:send", report),
  restartBackend: () => ipcRenderer.invoke("backend:restart"),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  windowToggleDevTools: () => ipcRenderer.invoke("window:toggleDevTools"),
  windowOpenWith: (opts) => ipcRenderer.invoke("window:open-with", opts || {}),

  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openHtmlPreview: (input) => ipcRenderer.invoke("preview:open-html", input),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  confirmDialog: (opts) => ipcRenderer.invoke("confirm-dialog", opts),
  requestShellCapability: (scope) => {
    if (!navigator.userActivation?.isActive) {
      return Promise.reject(
        new Error("Shell capabilities require an active user gesture.")
      )
    }
    return ipcRenderer.invoke("shell:capability", scope)
  },

  // NOTE: the legacy `claude:*` bridge (a second Claude Agent SDK provider
  // running in the main process) was removed. It accepted `permissionLevel`
  // straight from the renderer and honoured `"bypass"`, so any script running
  // in the renderer could have obtained unattended Bash/Write/Edit at an
  // arbitrary `projectPath`. The renderer had already stopped calling it —
  // every turn now goes through the authenticated backend, which owns the
  // permission decision. Do not reintroduce a privileged IPC channel that
  // takes its policy from its caller.

  onBackendStatus: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on("backend:status", listener);
    return () => ipcRenderer.removeListener("backend:status", listener);
  },

  // Requests the preview guests make, one entry per finished request.
  onPreviewRequest: (callback) => {
    const listener = (_, entry) => callback(entry);
    ipcRenderer.on("preview:request", listener);
    return () => ipcRenderer.removeListener("preview:request", listener);
  },

  // Onboarding
  onboardingIsDone: () => ipcRenderer.invoke("onboarding:is-done"),
  onboardingScan: (scanContext) =>
    ipcRenderer.invoke("onboarding:scan", scanContext),
  onboardingImport: (selections) => ipcRenderer.invoke("onboarding:import", selections),
  onboardingComplete: () => ipcRenderer.invoke("onboarding:complete"),
  onboardingReset: () => ipcRenderer.invoke("onboarding:reset"),

  // CLI auto-sync (startup import of new CLI-configured servers/skills/agents)
  cliAutoSync: (scanContext) =>
    ipcRenderer.invoke("cli:auto-sync", scanContext),

  // Checkpoint / Rewind
  rewindFiles: (pluginId, threadId, userMessageId) => ipcRenderer.invoke("plugin:send", { pluginId, method: "rewindFiles", args: { threadId, userMessageId } }),

  // MCP Servers
  mcpList: () => ipcRenderer.invoke("mcp:list"),
  mcpInstall: (config) => ipcRenderer.invoke("mcp:install", config),
  mcpRemove: (id) => ipcRenderer.invoke("mcp:remove", { id }),
  mcpUpdateEnv: (id, env) => ipcRenderer.invoke("mcp:update-env", { id, env }),
  mcpSetEnabled: (id, enabled) =>
    ipcRenderer.invoke("mcp:set-enabled", { id, enabled }),
  mcpProbe: (config) => ipcRenderer.invoke("mcp:probe", config),

  // Custom Skills
  skillList: () => ipcRenderer.invoke("skill:list"),
  skillSave: (data) => ipcRenderer.invoke("skill:save", data),
  skillDelete: (id) => ipcRenderer.invoke("skill:delete", { id }),
  skillImportUrl: (url, name) => ipcRenderer.invoke("skill:import-url", { url, name }),
  skillsShPreview: (repo) => ipcRenderer.invoke("skill:skills-sh-preview", { repo }),
  skillsShAdd: (repo, skill) => ipcRenderer.invoke("skill:skills-sh-add", { repo, skill }),
  skillsShSearch: (query) => ipcRenderer.invoke("skill:skills-sh-search", { query }),

  // Runtime rules / hooks / subagents
  rulesGet: () => ipcRenderer.invoke("rules:get"),
  rulesSave: (content) => ipcRenderer.invoke("rules:save", content),
  hookList: () => ipcRenderer.invoke("hook:list"),
  hookSave: (hook) => ipcRenderer.invoke("hook:save", hook),
  hookDelete: (id) => ipcRenderer.invoke("hook:delete", { id }),
  hookUpdateRun: (id, status, exitCode, error) =>
    ipcRenderer.invoke("hook:update-run", { id, status, exitCode, error }),
  subagentList: () => ipcRenderer.invoke("subagent:list"),
  subagentSave: (agent) => ipcRenderer.invoke("subagent:save", agent),
  subagentDelete: (id) => ipcRenderer.invoke("subagent:delete", { id }),

  // Provider catalog + OAuth (PR1–PR4). The Settings UI reads `providerList()`
  // to render its rows, calls `providerOauthStart(id, handler)` for the
  // "Sign in with X" buttons, and clears stored credentials via
  // `providerAuthClear(id)`.
  providerList: () => ipcRenderer.invoke("provider:list"),
  providerAuthStatus: () => ipcRenderer.invoke("provider:auth-status"),
  providerOauthStart: (providerId, handler) =>
    ipcRenderer.invoke("provider:oauth-start", { providerId, handler }),
  providerAuthClear: (providerId) =>
    ipcRenderer.invoke("provider:auth-clear", { providerId }),

  // CLI plugins (Claude Code / Codex plugin inventory)
  cliPluginInventory: (opts) => ipcRenderer.invoke("cliPlugin:inventory", opts || {}),
  cliPluginAvailable: () => ipcRenderer.invoke("cliPlugin:available"),
  cliPluginToggle: (source, id, enabled) =>
    ipcRenderer.invoke("cliPlugin:toggle", { source, id, enabled }),
  cliPluginInstall: (source, id) =>
    ipcRenderer.invoke("cliPlugin:install", { source, id }),
  cliPluginUninstall: (source, id) =>
    ipcRenderer.invoke("cliPlugin:uninstall", { source, id }),

  // Plugin system
  pluginList: () => ipcRenderer.invoke("plugin:list"),
  pluginInstall: (sourcePath) => ipcRenderer.invoke("plugin:install", { sourcePath }),
  pluginInstallDefault: (pluginId) => ipcRenderer.invoke("plugin:install-default", { pluginId }),
  pluginRemove: (pluginId) => ipcRenderer.invoke("plugin:remove", { pluginId }),
  pluginToggle: (pluginId, enabled) => ipcRenderer.invoke("plugin:toggle", { pluginId, enabled }),
  pluginConfigGet: (pluginId) => ipcRenderer.invoke("plugin:config-get", { pluginId }),
  pluginConfigSet: (pluginId, key, value) => ipcRenderer.invoke("plugin:config-set", { pluginId, key, value }),
  pluginSend: (pluginId, method, args) => ipcRenderer.invoke("plugin:send", { pluginId, method, args }),
  onPluginEvent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on("plugin:event", listener);
    return () => ipcRenderer.removeListener("plugin:event", listener);
  },
});
