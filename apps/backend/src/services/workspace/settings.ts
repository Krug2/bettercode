import path from "node:path"
import { logger } from "../../observability/logger"
import { readConfigValue } from "./formatters"
import { readBooleanRecord } from "./permissions"
import {
  normalizeProjectTuiConfig,
  readBetterC0deProjectConfigs,
  readBetterC0deProjectTuiConfigs,
  readRecord,
} from "./project-config"
import { readPositiveInteger, readString } from "./providers"
import { readStringArray } from "./search"

export interface ProjectConfigSettingTemplate {
  key: string
  label: string
  kind: "scalar" | "toggle" | "list" | "object"
  value: string
  sourcePath: string
}

export interface ProjectToolOutputLimits {
  maxLines: number
  maxBytes: number
  sourcePath?: string
}

export async function listProjectConfigSettings(
  cwd: string
): Promise<ProjectConfigSettingTemplate[]> {
  const root = path.resolve(cwd)
  const settings: ProjectConfigSettingTemplate[] = []

  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root
  )) {
    settings.push(...projectConfigSettingsFromConfig(config, sourcePath))
  }
  for (const { config, sourcePath } of await readBetterC0deProjectTuiConfigs(
    root
  )) {
    settings.push(...projectTuiConfigSettingsFromConfig(config, sourcePath))
  }

  return settings
}

export async function isProjectSnapshotEnabled(cwd: string): Promise<boolean> {
  const root = path.resolve(cwd)
  let enabled = true
  for (const { config } of await readBetterC0deProjectConfigs(root)) {
    const value = readConfigValue(config, "snapshot")
    if (typeof value === "boolean") enabled = value
  }
  return enabled
}

/**
 * Shell identifiers a repository may select. `resolveShellCommandLaunch` maps
 * these onto a fixed argv; anything outside the set falls through to the
 * platform default there anyway.
 */
const WORKSPACE_SELECTABLE_SHELL_IDS = new Set([
  "bash",
  "zsh",
  "sh",
  "pwsh",
  "powershell",
  "cmd",
  "gitbash",
  "git-bash",
  "wsl",
])

/**
 * The shell binary every `/shell/run` and every interactive PTY is launched
 * with — including terminals the human types into.
 *
 * A workspace-controlled config may *select* a known shell, but may not name
 * an arbitrary program: `resolveShellCommandLaunch` spawns an absolute
 * `shellId` directly, so `{"shell": "/tmp/x"}` in a cloned repository's
 * `betterc0de.json` would have run that binary for every command the user
 * typed. It also gave a write-only agent a route to execution — write the
 * config, write the script, wait for the user to open a terminal. Absolute
 * paths remain available from the user's own global/managed config.
 */
export async function getProjectShell(
  cwd: string
): Promise<string | undefined> {
  const root = path.resolve(cwd)
  let shell: string | undefined
  for (const {
    config,
    sourcePath,
    workspaceControlled,
  } of await readBetterC0deProjectConfigs(root)) {
    const candidate = readString(readConfigValue(config, "shell"))
    if (candidate === undefined) continue
    if (
      workspaceControlled &&
      !WORKSPACE_SELECTABLE_SHELL_IDS.has(candidate.trim().toLowerCase())
    ) {
      logger.warn(
        { sourcePath },
        "ignoring workspace-controlled shell override that is not a known shell id"
      )
      continue
    }
    shell = candidate
  }
  return shell
}

export async function getProjectToolOutputLimits(
  cwd: string
): Promise<ProjectToolOutputLimits> {
  const root = path.resolve(cwd)
  const limits: ProjectToolOutputLimits = {
    maxLines: 2_000,
    maxBytes: 50 * 1024,
  }
  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root
  )) {
    const toolOutput = readRecord(config, "tool_output")
    const maxLines = readPositiveInteger(toolOutput.max_lines)
    const maxBytes = readPositiveInteger(toolOutput.max_bytes)
    if (maxLines || maxBytes) {
      if (maxLines) limits.maxLines = maxLines
      if (maxBytes) limits.maxBytes = maxBytes
      limits.sourcePath = `${sourcePath}#tool_output`
    }
  }
  return limits
}

const BetterC0de_PROJECT_CONFIG_LABELS: Record<string, string> = {
  $schema: "Schema",
  shell: "Shell",
  logLevel: "Log level",
  server: "Server",
  command: "Commands",
  skills: "Skills",
  reference: "References",
  watcher: "Watcher",
  snapshot: "Snapshots",
  plugin: "Plugins",
  share: "Share mode",
  autoshare: "Legacy auto-share",
  "runtime.autoShare": "Runtime auto-share",
  "runtime.pure": "Pure mode",
  "runtime.disableDefaultPlugins": "Disable default plugins",
  "runtime.bashDefaultTimeoutMs": "Bash default timeout",
  "runtime.disableClaudeCodePrompt": "Disable Claude Code prompt",
  "runtime.disableAutoupdate": "Disable auto-update",
  "runtime.alwaysNotifyUpdate": "Always notify update",
  "runtime.disableModelsFetch": "Disable models fetch",
  "runtime.modelsUrl": "Models URL",
  "runtime.modelsPath": "Models path",
  "runtime.fakeVcs": "Fake VCS",
  "runtime.workspaceId": "Workspace ID",
  "runtime.autoHeapSnapshot": "Auto heap snapshot",
  "runtime.experimentalFileWatcher": "Experimental file watcher",
  "runtime.experimentalDisableFileWatcher": "Disable file watcher",
  "runtime.experimentalDisableCopyOnSelect": "Disable copy on select",
  "runtime.directTrace": "Direct trace",
  "runtime.disableMouse": "Disable mouse",
  "runtime.disableTerminalTitle": "Disable terminal title",
  "runtime.showTtfd": "Show TTFD",
  "runtime.experimental": "Experimental runtime",
  "runtime.disableChannelDb": "Disable channel database",
  "runtime.disableEmbeddedWebUi": "Disable embedded web UI",
  "runtime.disableExternalSkills": "Disable external skills",
  "runtime.disableLspDownload": "Disable LSP download",
  "runtime.skipMigrations": "Skip migrations",
  "runtime.disableClaudeCodeSkills": "Disable Claude Code skills",
  "runtime.enableExa": "Enable Exa search",
  "runtime.enableParallel": "Enable parallel search",
  "runtime.webSearchProvider": "Web search provider",
  "runtime.enableExperimentalModels": "Enable experimental models",
  "runtime.enableQuestionTool": "Enable question tool",
  "runtime.experimentalScout": "Experimental scout",
  "runtime.experimentalBackgroundSubagents":
    "Experimental background subagents",
  "runtime.experimentalLspTy": "Experimental ty LSP",
  "runtime.experimentalLspTool": "Experimental LSP tool",
  "runtime.experimentalOxfmt": "Experimental oxfmt",
  "runtime.experimentalPlanMode": "Experimental plan mode",
  "runtime.experimentalEventSystem": "Experimental event system",
  "runtime.experimentalWorkspaces": "Experimental workspaces",
  "runtime.experimentalIconDiscovery": "Experimental icon discovery",
  "runtime.outputTokenMax": "Output token max",
  "runtime.experimentalNativeLlm": "Experimental native LLM",
  "runtime.client": "Runtime client",
  "runtime.repoCloneGithubBaseUrl": "Repo clone GitHub base URL",
  autoupdate: "Auto-update",
  disabled_providers: "Disabled providers",
  enabled_providers: "Enabled providers",
  model: "Default model",
  small_model: "Small model",
  default_agent: "Default agent",
  username: "Username",
  mode: "Legacy modes",
  agent: "Agents",
  provider: "Providers",
  mcp: "MCP servers",
  formatter: "Formatters",
  lsp: "LSP servers",
  instructions: "Instructions",
  layout: "Layout",
  permission: "Permissions",
  tools: "Tools",
  attachment: "Attachments",
  enterprise: "Enterprise",
  tool_output: "Tool output",
  compaction: "Compaction",
  experimental: "Experimental",
  theme: "TUI theme",
  keybinds: "TUI keybinds",
  plugin_enabled: "TUI plugin enabled",
  leader_timeout: "Leader timeout",
  attention: "Attention",
  scroll_speed: "Scroll speed",
  scroll_acceleration: "Scroll acceleration",
  diff_style: "Diff style",
  mouse: "Mouse capture",
}

function projectConfigSettingsFromConfig(
  config: unknown,
  sourcePath: string
): ProjectConfigSettingTemplate[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return []

  const settings: ProjectConfigSettingTemplate[] = []
  const record = config as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    const formatted = formatProjectConfigValue(value)
    settings.push({
      key,
      label: Object.hasOwn(BetterC0de_PROJECT_CONFIG_LABELS, key)
        ? BetterC0de_PROJECT_CONFIG_LABELS[key]
        : key,
      kind: formatted.kind,
      value: formatted.value,
      sourcePath: `${sourcePath}#${key}`,
    })
  }

  const watcher = readRecord(record, "watcher")
  const ignore = readStringArray(watcher.ignore)
  if (ignore.length > 0) {
    settings.push({
      key: "watcher.ignore",
      label: "Watcher ignore",
      kind: "list",
      value: ignore.join(", "),
      sourcePath: `${sourcePath}#watcher.ignore`,
    })
  }

  const skills = readRecord(record, "skills")
  const skillPaths = readStringArray(skills.paths)
  if (skillPaths.length > 0) {
    settings.push({
      key: "skills.paths",
      label: "Skill paths",
      kind: "list",
      value: skillPaths.join(", "),
      sourcePath: `${sourcePath}#skills.paths`,
    })
  }
  const skillUrls = readStringArray(skills.urls)
  if (skillUrls.length > 0) {
    settings.push({
      key: "skills.urls",
      label: "Skill URLs",
      kind: "list",
      value: skillUrls.join(", "),
      sourcePath: `${sourcePath}#skills.urls`,
    })
  }

  settings.push(...projectNestedConfigSettingsFromConfig(record, sourcePath))

  return settings
}

function projectTuiConfigSettingsFromConfig(
  config: unknown,
  sourcePath: string
): ProjectConfigSettingTemplate[] {
  const normalized = normalizeProjectTuiConfig(config)
  const settings = projectConfigSettingsFromConfig(normalized, sourcePath)
  settings.push(...projectTuiNestedSettingsFromConfig(normalized, sourcePath))
  return settings
}

function projectTuiNestedSettingsFromConfig(
  record: Record<string, unknown>,
  sourcePath: string
): ProjectConfigSettingTemplate[] {
  const settings: ProjectConfigSettingTemplate[] = []

  const keybinds = readRecord(record, "keybinds")
  for (const [name, value] of Object.entries(keybinds)) {
    pushProjectConfigSetting(settings, sourcePath, {
      key: `keybinds.${name}`,
      label: `Keybind ${humanizeConfigKey(name)}`,
      value,
    })
  }

  const attention = readRecord(record, "attention")
  for (const [key, value] of Object.entries(attention)) {
    if (key === "sounds") continue
    pushProjectConfigSetting(settings, sourcePath, {
      key: `attention.${key}`,
      label: `Attention ${humanizeConfigKey(key)}`,
      value,
    })
  }
  for (const [name, value] of Object.entries(readRecord(attention, "sounds"))) {
    pushProjectConfigSetting(settings, sourcePath, {
      key: `attention.sounds.${name}`,
      label: `Attention sound ${humanizeConfigKey(name)}`,
      value,
    })
  }

  const scrollAcceleration = readRecord(record, "scroll_acceleration")
  for (const [key, value] of Object.entries(scrollAcceleration)) {
    pushProjectConfigSetting(settings, sourcePath, {
      key: `scroll_acceleration.${key}`,
      label: `Scroll acceleration ${humanizeConfigKey(key)}`,
      value,
    })
  }

  return settings
}

function projectNestedConfigSettingsFromConfig(
  record: Record<string, unknown>,
  sourcePath: string
): ProjectConfigSettingTemplate[] {
  const settings: ProjectConfigSettingTemplate[] = []

  for (const [tool, enabled] of Object.entries(
    readBooleanRecord(readConfigValue(record, "tools"))
  )) {
    pushProjectConfigSetting(settings, sourcePath, {
      key: `tools.${tool}`,
      label: `Tool ${humanizeConfigKey(tool)}`,
      value: enabled,
    })
  }

  const fields: Array<{
    readonly path: readonly string[]
    readonly label: string
  }> = [
    { path: ["server", "hostname"], label: "Server hostname" },
    { path: ["server", "port"], label: "Server port" },
    { path: ["server", "mdns"], label: "Server mDNS" },
    { path: ["server", "mdnsDomain"], label: "Server mDNS domain" },
    { path: ["server", "cors"], label: "Server CORS" },
    { path: ["tool_output", "max_lines"], label: "Tool output max lines" },
    { path: ["tool_output", "max_bytes"], label: "Tool output max bytes" },
    { path: ["compaction", "auto"], label: "Compaction auto" },
    { path: ["compaction", "prune"], label: "Compaction prune" },
    { path: ["compaction", "tail_turns"], label: "Compaction tail turns" },
    {
      path: ["compaction", "preserve_recent_tokens"],
      label: "Compaction preserve recent tokens",
    },
    { path: ["compaction", "reserved"], label: "Compaction token buffer" },
    {
      path: ["experimental", "disable_paste_summary"],
      label: "Disable paste summary",
    },
    { path: ["experimental", "batch_tool"], label: "Batch tool" },
    { path: ["experimental", "openTelemetry"], label: "OpenTelemetry" },
    { path: ["experimental", "primary_tools"], label: "Primary tools" },
    {
      path: ["experimental", "continue_loop_on_deny"],
      label: "Continue loop on deny",
    },
    { path: ["experimental", "mcp_timeout"], label: "MCP timeout" },
    { path: ["enterprise", "url"], label: "Enterprise URL" },
  ]

  for (const field of fields) {
    pushProjectConfigSetting(settings, sourcePath, {
      key: field.path.join("."),
      label: field.label,
      value: readNestedConfigValue(record, field.path),
    })
  }

  const imageAttachment = readRecord(
    readConfigValue(record, "attachment"),
    "image"
  )
  for (const [key, value] of Object.entries(imageAttachment)) {
    pushProjectConfigSetting(settings, sourcePath, {
      key: `attachment.image.${key}`,
      label: `Image attachment ${humanizeConfigKey(key)}`,
      value,
    })
  }

  return settings
}

function pushProjectConfigSetting(
  settings: ProjectConfigSettingTemplate[],
  sourcePath: string,
  input: {
    readonly key: string
    readonly label: string
    readonly value: unknown
  }
): void {
  if (typeof input.value === "undefined") return
  const formatted = formatProjectConfigValue(input.value)
  settings.push({
    key: input.key,
    label: input.label,
    kind: formatted.kind,
    value: formatted.value,
    sourcePath: `${sourcePath}#${input.key}`,
  })
}

function readNestedConfigValue(
  input: Record<string, unknown>,
  pathSegments: readonly string[]
): unknown {
  let current: unknown = input
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function humanizeConfigKey(key: string): string {
  return key.replace(/[_-]+/g, " ")
}

function formatProjectConfigValue(
  value: unknown
): Pick<ProjectConfigSettingTemplate, "kind" | "value"> {
  if (typeof value === "boolean") {
    return { kind: "toggle", value: value ? "enabled" : "disabled" }
  }
  if (typeof value === "string" || typeof value === "number") {
    return { kind: "scalar", value: String(value) }
  }
  if (Array.isArray(value)) {
    return {
      kind: "list",
      value:
        value.length === 0
          ? "(empty)"
          : value.map(formatCompactConfigValue).join(", "),
    }
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return { kind: "object", value: "(empty)" }
    const simpleEntries = entries.every(([, item]) =>
      isCompactConfigValue(item)
    )
    return {
      kind: "object",
      value: simpleEntries
        ? entries
            .map(
              ([entryKey, item]) =>
                `${entryKey}=${formatCompactConfigValue(item)}`
            )
            .join(", ")
        : entries
            .map(([entryKey, item]) =>
              isCompactConfigValue(item)
                ? `${entryKey}=${formatCompactConfigValue(item)}`
                : `${entryKey}{${objectEntryCount(item)}}`
            )
            .join(", "),
    }
  }
  return { kind: "scalar", value: String(value) }
}

function isCompactConfigValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

function formatCompactConfigValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value === null) return "null"
  if (typeof value === "number") return String(value)
  return JSON.stringify(value)
}

function objectEntryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== "object") return 0
  return Object.keys(value as Record<string, unknown>).length
}
