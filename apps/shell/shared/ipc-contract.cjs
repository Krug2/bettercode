/**
 * IPC channel names — authoritative source for the `.cjs` (preload/main)
 * side of the bridge. The TypeScript twin in `ipc-contract.ts` MUST export
 * the same literal values. A vitest parity test enforces this.
 *
 * Use these constants everywhere in .cjs code instead of string literals so
 * rename-refactors actually rename all references.
 */

const IpcChannel = Object.freeze({
  // App / window
  AppInfo: "app:info",
  BugReportSend: "bug-report:send",
  BackendRestart: "backend:restart",
  WindowMinimize: "window:minimize",
  WindowMaximize: "window:maximize",
  WindowClose: "window:close",
  WindowIsMaximized: "window:isMaximized",
  WindowToggleDevTools: "window:toggleDevTools",
  // Spawns a secondary BrowserWindow with mode + cwd carried in the URL
  // hash. Used by the file-tree's "Open in Editor Mode" right-click.
  WindowOpenWith: "window:open-with",
  DeviceOpen: "device:open",
  OpenExternal: "open-external",
  OpenPath: "open-path",
  PickFolder: "pick-folder",
  OpenHtmlPreview: "preview:open-html",
  ClipboardWriteText: "clipboard:write-text",
  ConfirmDialog: "confirm-dialog",
  ShellCapability: "shell:capability",

  // Onboarding
  OnboardingIsDone: "onboarding:is-done",
  OnboardingScan: "onboarding:scan",
  OnboardingImport: "onboarding:import",
  OnboardingComplete: "onboarding:complete",
  OnboardingReset: "onboarding:reset",

  // CLI auto-sync
  CliAutoSync: "cli:auto-sync",

  // MCP servers
  McpList: "mcp:list",
  McpInstall: "mcp:install",
  McpRemove: "mcp:remove",
  McpUpdateEnv: "mcp:update-env",
  McpSetEnabled: "mcp:set-enabled",
  McpProbe: "mcp:probe",

  // Custom skills
  SkillList: "skill:list",
  SkillSave: "skill:save",
  SkillDelete: "skill:delete",
  SkillImportUrl: "skill:import-url",
  // skills.sh registry (npx skills)
  SkillsShPreview: "skill:skills-sh-preview",
  SkillsShAdd: "skill:skills-sh-add",
  SkillsShSearch: "skill:skills-sh-search",

  // Rules
  RulesGet: "rules:get",
  RulesSave: "rules:save",

  // Hooks
  HookList: "hook:list",
  HookSave: "hook:save",
  HookDelete: "hook:delete",
  HookUpdateRun: "hook:update-run",

  // Subagents
  SubagentList: "subagent:list",
  SubagentSave: "subagent:save",
  SubagentDelete: "subagent:delete",

  // CLI plugins (Claude Code / Codex CLI plugin inventory — distinct from
  // the BetterC0de provider-plugin system on the `plugin:*` namespace)
  CliPluginInventory: "cliPlugin:inventory",
  CliPluginAvailable: "cliPlugin:available",
  CliPluginToggle: "cliPlugin:toggle",
  CliPluginInstall: "cliPlugin:install",
  CliPluginUninstall: "cliPlugin:uninstall",

  // Plugin system
  PluginList: "plugin:list",
  PluginInstall: "plugin:install",
  PluginInstallDefault: "plugin:install-default",
  PluginRemove: "plugin:remove",
  PluginToggle: "plugin:toggle",
  PluginConfigGet: "plugin:config-get",
  PluginConfigSet: "plugin:config-set",
  PluginSend: "plugin:send",

  // Provider catalog + OAuth (PR1–PR4)
  ProviderList: "provider:list",
  ProviderAuthStatus: "provider:auth-status",
  ProviderOauthStart: "provider:oauth-start",
  ProviderAuthClear: "provider:auth-clear",
})

/** Event channels (renderer subscribes via `ipcRenderer.on`). */
const IpcEvent = Object.freeze({
  BackendStatus: "backend:status",
  PluginEvent: "plugin:event",
  /** One finished request of a preview guest (canvas runtime pane). */
  PreviewRequest: "preview:request",
})

module.exports = { IpcChannel, IpcEvent }
