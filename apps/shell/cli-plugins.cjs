/**
 * CLI plugin inventory — enumerates plugins installed in the user's
 * Claude Code CLI (`~/.claude/plugins`) and Codex CLI (`codex plugin`).
 *
 * Deliberately separate from BetterC0de's own provider-plugin system
 * (`plugin-manager.cjs`, `plugin:*` IPC): these plugins belong to the CLIs,
 * which load them natively in their own sessions. BetterC0de only
 * inventories them (and, in later phases, toggles them via the CLIs).
 *
 * Claude inventory is pure file reads (registry + cache dirs); Codex
 * inventory shells out to `codex plugin list --json` because install paths
 * live in runtime-managed caches that must never be guessed, with a
 * degraded `config.toml` fallback when the binary is unavailable.
 */

const fs = require("fs")
const crypto = require("crypto")
const os = require("os")
const path = require("path")
const {
  runCli: defaultRunCli,
  resolveCliBinary,
} = require("./shared/spawn-cli.cjs")
const { readJson, readBoundedRegularFile } = require("./shared/json-fs.cjs")
const { assertPathContained } = require("./shared/security-checks.cjs")

const INVENTORY_CACHE_TTL_MS = 30_000
const MAX_CLI_CONFIG_BYTES = 1024 * 1024

function expandHome(value) {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

// Same resolution rules as skills-ipc.cjs / the backend adapters.
function resolveClaudeConfigDir() {
  const configured = process.env.CLAUDE_CONFIG_DIR
  if (typeof configured === "string" && configured.trim()) {
    // CLAUDE_CONFIG_DIR names the config directory itself; unlike HOME it
    // must not gain an implicit `.claude` suffix.
    return path.resolve(expandHome(configured.trim()))
  }
  return path.join(os.homedir(), ".claude")
}

function resolveCodexHome() {
  const configured = process.env.CODEX_HOME
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(expandHome(configured.trim()))
  }
  return path.join(os.homedir(), ".codex")
}

/** Strip the Windows extended-length prefix codex writes into marketplace paths. */
function normalizeWindowsInstallPath(value) {
  if (typeof value !== "string") return ""
  return value.startsWith("\\\\?\\") ? value.slice(4) : value
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function listFiles(dir, extension) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          (!extension || entry.name.toLowerCase().endsWith(extension))
      )
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Minimal YAML-frontmatter reader: `name:` / `description:` string fields. */
function parseSkillFrontmatter(markdown) {
  const result = {}
  if (typeof markdown !== "string" || !markdown.startsWith("---")) return result
  const end = markdown.indexOf("\n---", 3)
  if (end < 0) return result
  for (const line of markdown.slice(3, end).split("\n")) {
    const match = line.match(/^(name|description)\s*:\s*(.+)\s*$/)
    if (!match) continue
    result[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
  }
  return result
}

const SKILL_FILE_CANDIDATES = ["SKILL.md", "skill.md"]

function readSkillComponents(skillsDir) {
  const skills = []
  for (const name of listDirs(skillsDir)) {
    const skillDir = path.join(skillsDir, name)
    let meta = {}
    for (const candidate of SKILL_FILE_CANDIDATES) {
      const file = path.join(skillDir, candidate)
      try {
        if (fs.existsSync(file)) {
          meta = parseSkillFrontmatter(readBoundedRegularFile(file, MAX_CLI_CONFIG_BYTES).toString("utf8"))
          break
        }
      } catch {
        // unreadable SKILL.md — keep directory-derived name
      }
    }
    skills.push({
      name: meta.name || name,
      ...(meta.description ? { description: meta.description } : {}),
      path: skillDir,
    })
  }
  return skills
}

function readMcpServerComponents(mcpJsonPath) {
  const parsed = readJson(mcpJsonPath)
  if (!parsed || typeof parsed !== "object") return []
  const map =
    parsed.mcpServers && typeof parsed.mcpServers === "object"
      ? parsed.mcpServers
      : parsed
  const servers = []
  for (const [name, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    servers.push({
      name,
      ...(typeof raw.type === "string" ? { transport: raw.type } : {}),
      ...(typeof raw.command === "string" ? { command: raw.command } : {}),
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
    })
  }
  return servers
}

function readMarkdownComponents(dir, { recurse = false } = {}) {
  const entries = []
  const walk = (current, prefix) => {
    for (const file of listFiles(current, ".md")) {
      entries.push({ name: prefix + file.replace(/\.md$/i, "") })
    }
    if (!recurse) return
    for (const sub of listDirs(current)) {
      walk(path.join(current, sub), `${prefix}${sub}/`)
    }
  }
  walk(dir, "")
  return entries
}

function emptyComponents() {
  return { skills: [], agents: [], commands: [], mcpServers: [], hooks: [] }
}

/**
 * Component inventory of a Claude Code plugin install dir:
 * `.claude-plugin/plugin.json`, `skills/`, `agents/`, `commands/`,
 * `hooks/hooks.json`, `.mcp.json`.
 */
function readClaudePluginComponents(installPath) {
  const manifest =
    readJson(path.join(installPath, ".claude-plugin", "plugin.json")) || {}
  const components = emptyComponents()
  components.skills = readSkillComponents(path.join(installPath, "skills"))
  components.agents = readMarkdownComponents(path.join(installPath, "agents"))
  components.commands = readMarkdownComponents(
    path.join(installPath, "commands"),
    {
      recurse: true,
    }
  )
  components.mcpServers = readMcpServerComponents(
    path.join(installPath, ".mcp.json")
  )
  const hooks = readJson(path.join(installPath, "hooks", "hooks.json"))
  if (hooks && typeof hooks === "object") {
    const hookMap =
      hooks.hooks && typeof hooks.hooks === "object" ? hooks.hooks : hooks
    components.hooks = Object.keys(hookMap)
  }
  return {
    components,
    ...(typeof manifest.description === "string"
      ? { description: manifest.description }
      : {}),
    ...(typeof manifest.homepage === "string"
      ? { homepage: manifest.homepage }
      : {}),
  }
}

/**
 * Component inventory of a Codex plugin install dir:
 * `.codex-plugin/plugin.json` (incl. `interface` block), `skills/`, `.mcp.json`.
 */
function readCodexPluginComponents(installPath) {
  const manifest =
    readJson(path.join(installPath, ".codex-plugin", "plugin.json")) || {}
  const components = emptyComponents()
  components.skills = readSkillComponents(path.join(installPath, "skills"))
  const mcpPointer =
    typeof manifest.mcpServers === "string"
      ? manifest.mcpServers
      : "./.mcp.json"
  const mcpFile = resolveInsideInstall(installPath, mcpPointer)
  components.mcpServers = mcpFile ? readMcpServerComponents(mcpFile) : []
  const iface =
    manifest.interface && typeof manifest.interface === "object"
      ? manifest.interface
      : null
  return {
    components,
    ...(typeof manifest.description === "string"
      ? { description: manifest.description }
      : {}),
    ...(typeof manifest.homepage === "string"
      ? { homepage: manifest.homepage }
      : {}),
    ...(iface
      ? {
          interface: {
            ...(typeof iface.displayName === "string"
              ? { displayName: iface.displayName }
              : {}),
            ...(typeof iface.shortDescription === "string"
              ? { shortDescription: iface.shortDescription }
              : {}),
            ...(typeof iface.category === "string"
              ? { category: iface.category }
              : {}),
            ...(typeof iface.logo === "string"
              ? logoInsideInstall(installPath, iface.logo)
              : {}),
            ...(typeof iface.brandColor === "string"
              ? { brandColor: iface.brandColor }
              : {}),
          },
        }
      : {}),
  }
}

function splitPluginId(id) {
  const at = id.lastIndexOf("@")
  if (at <= 0) return { name: id, marketplace: "" }
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) }
}

/**
 * Whether a plugin id is enabled per `settings.json`'s `enabledPlugins`.
 * Current Claude CLI writes an OBJECT MAP `{"id@mp": true|false}`; older
 * versions wrote an ARRAY of enabled ids. (The legacy `.map()` call on the
 * object shape is what crashed cli-scanner.cjs.)
 */
function isClaudePluginEnabled(enabledPlugins, id) {
  if (Array.isArray(enabledPlugins)) return enabledPlugins.includes(id)
  if (enabledPlugins && typeof enabledPlugins === "object") {
    return enabledPlugins[id] !== false
  }
  return true
}

/**
 * Parse the v2 registry (`~/.claude/plugins/installed_plugins.json`):
 * `{version: 2, plugins: {"name@marketplace": [{scope, installPath, version, ...}]}}`.
 * Values are ARRAYS of installs per id; prefer the `user`-scoped install.
 */
function parseClaudeInstalledPlugins({
  installedPluginsJson,
  enabledPluginsMap,
}) {
  const registry =
    installedPluginsJson &&
    typeof installedPluginsJson === "object" &&
    installedPluginsJson.plugins &&
    typeof installedPluginsJson.plugins === "object"
      ? installedPluginsJson.plugins
      : {}
  const plugins = []
  for (const [id, rawInstalls] of Object.entries(registry)) {
    const installs = Array.isArray(rawInstalls)
      ? rawInstalls.filter((entry) => entry && typeof entry === "object")
      : rawInstalls && typeof rawInstalls === "object"
        ? [rawInstalls]
        : []
    if (installs.length === 0) continue
    const install =
      installs.find((entry) => entry.scope === "user") ?? installs[0]
    const { name, marketplace } = splitPluginId(id)
    plugins.push({
      source: "claude",
      id,
      name,
      marketplace,
      version:
        typeof install.version === "string" ? install.version : "unknown",
      scope: install.scope === "project" ? "project" : "user",
      enabled: isClaudePluginEnabled(enabledPluginsMap, id),
      installPath: normalizeWindowsInstallPath(
        typeof install.installPath === "string" ? install.installPath : ""
      ),
      components: emptyComponents(),
    })
  }
  return plugins
}

/** Parse `codex plugin list --json` stdout. */
function parseCodexPluginListJson(stdoutText) {
  let parsed
  try {
    parsed = JSON.parse(stdoutText)
  } catch {
    throw new Error("codex plugin list returned non-JSON output")
  }
  const mapEntry = (entry, installed) => {
    if (!entry || typeof entry !== "object") return null
    const id =
      typeof entry.pluginId === "string" && entry.pluginId
        ? entry.pluginId
        : typeof entry.name === "string"
          ? entry.name
          : null
    if (!id) return null
    const { name, marketplace } = splitPluginId(id)
    return {
      source: "codex",
      id,
      name: typeof entry.name === "string" ? entry.name : name,
      marketplace:
        typeof entry.marketplaceName === "string"
          ? entry.marketplaceName
          : marketplace,
      version: typeof entry.version === "string" ? entry.version : "unknown",
      scope: "user",
      enabled: entry.enabled !== false,
      installed,
      installPath: normalizeWindowsInstallPath(
        entry.source && typeof entry.source === "object"
          ? entry.source.path || ""
          : ""
      ),
      components: emptyComponents(),
    }
  }
  const installed = Array.isArray(parsed?.installed) ? parsed.installed : []
  const available = Array.isArray(parsed?.available) ? parsed.available : []
  return {
    installed: installed.map((e) => mapEntry(e, true)).filter(Boolean),
    available: available.map((e) => mapEntry(e, false)).filter(Boolean),
  }
}

/**
 * Degraded fallback when the codex binary is unavailable: plugin ids +
 * enabled flags from `config.toml` `[plugins."name@marketplace"]` sections.
 */
function parseCodexConfigTomlPlugins(tomlText) {
  if (typeof tomlText !== "string" || !tomlText) return []
  const plugins = []
  let currentId = null
  for (const line of tomlText.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const section = trimmed.match(/^\[plugins\."([^"]+)"]$/)
    if (section) {
      currentId = section[1]
      const { name, marketplace } = splitPluginId(currentId)
      plugins.push({
        source: "codex",
        id: currentId,
        name,
        marketplace,
        version: "unknown",
        scope: "user",
        enabled: true,
        installPath: "",
        components: emptyComponents(),
      })
      continue
    }
    if (trimmed.startsWith("[")) {
      currentId = null
      continue
    }
    if (!currentId) continue
    const kv = trimmed.match(/^enabled\s*=\s*(true|false)\s*(#.*)?$/)
    if (kv) {
      const plugin = plugins.find((entry) => entry.id === currentId)
      if (plugin) plugin.enabled = kv[1] === "true"
    }
  }
  return plugins
}

function withComponents(plugin, reader) {
  if (!plugin.installPath) return plugin
  try {
    if (!fs.existsSync(plugin.installPath)) return plugin
    const detail = reader(plugin.installPath)
    return { ...plugin, ...detail }
  } catch {
    return plugin
  }
}

async function collectClaudeInventory() {
  const configDir = resolveClaudeConfigDir()
  const pluginsDir = path.join(configDir, "plugins")
  const cliDetected = fs.existsSync(configDir)
  if (!cliDetected) return { cliDetected: false, plugins: [] }
  const installedPluginsJson = readJson(
    path.join(pluginsDir, "installed_plugins.json")
  )
  const settings = readJson(path.join(configDir, "settings.json"))
  const plugins = parseClaudeInstalledPlugins({
    installedPluginsJson,
    enabledPluginsMap: settings?.enabledPlugins,
  }).map((plugin) => withComponents(plugin, readClaudePluginComponents))
  return { cliDetected: true, plugins }
}

async function collectCodexInventory(runCli) {
  const binaryPath = resolveCliBinary("codex")
  const configTomlFallback = (error) => {
    let plugins = []
    try {
      plugins = parseCodexConfigTomlPlugins(
        readBoundedRegularFile(path.join(resolveCodexHome(), "config.toml"), MAX_CLI_CONFIG_BYTES).toString("utf8")
      )
    } catch {
      // no config.toml either — empty inventory
    }
    return {
      cliDetected: Boolean(binaryPath),
      ...(error ? { error } : {}),
      plugins,
    }
  }
  if (!binaryPath) {
    return configTomlFallback(
      "Codex CLI (`codex`) is not installed or not on PATH."
    )
  }
  try {
    const result = await runCli(binaryPath, ["plugin", "list", "--json"], {
      timeoutMs: 15_000,
    })
    if (result.timedOut) {
      return configTomlFallback("`codex plugin list` timed out.")
    }
    if (result.code !== 0) {
      const tail = (result.stderr || "").trim().split("\n").slice(-3).join("\n")
      return configTomlFallback(
        `\`codex plugin list\` exited with code ${result.code}${tail ? `: ${tail}` : "."}`
      )
    }
    const { installed } = parseCodexPluginListJson(result.stdout)
    const plugins = installed.map((plugin) =>
      withComponents(plugin, readCodexPluginComponents)
    )
    return { cliDetected: true, plugins }
  } catch (err) {
    return configTomlFallback(err?.message || String(err))
  }
}

let inventoryCache = null
let inventoryInFlight = null
let inventoryGeneration = 0

/**
 * Full CLI-plugin inventory across both CLIs. 30s cache + single-flight.
 * @returns {Promise<{claude: object, codex: object, scannedAt: number}>}
 */
async function getCliPluginInventory(options = {}) {
  const { force = false, runCli = defaultRunCli } = options
  if (
    !force &&
    inventoryCache &&
    Date.now() - inventoryCache.scannedAt < INVENTORY_CACHE_TTL_MS
  ) {
    return inventoryCache
  }
  if (!force && inventoryInFlight) return inventoryInFlight
  const generation = ++inventoryGeneration
  const pending = (async () => {
    const [claude, codex] = await Promise.all([
      collectClaudeInventory(),
      collectCodexInventory(runCli),
    ])
    const inventory = { claude, codex, scannedAt: Date.now() }
    if (generation === inventoryGeneration) inventoryCache = inventory
    return inventory
  })()
  inventoryInFlight = pending
  try {
    return await pending
  } finally {
    if (inventoryInFlight === pending) inventoryInFlight = null
  }
}

function invalidateCliPluginInventory() {
  inventoryGeneration += 1
  inventoryCache = null
  inventoryInFlight = null
}

// ── Mutations (Phase 3) ────────────────────────────────────────────────────

const CLI_PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@._/-]*$/

/** Reject ids that could be parsed as CLI flags or shell metacharacters. */
function validateCliPluginId(id) {
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Plugin id is required")
  }
  const trimmed = id.trim()
  if (
    !CLI_PLUGIN_ID_PATTERN.test(trimmed) ||
    trimmed.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Invalid plugin id: ${trimmed}`)
  }
  return trimmed
}

function resolveInsideInstall(installPath, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    return null
  }
  try {
    return assertPathContained(installPath, candidate, "plugin asset")
  } catch {
    return null
  }
}

function logoInsideInstall(installPath, candidate) {
  const logoPath = resolveInsideInstall(installPath, candidate)
  return logoPath ? { logoPath } : {}
}

function requireBinary(bin) {
  const binaryPath = resolveCliBinary(bin)
  if (!binaryPath) {
    throw new Error(`${bin} CLI is not installed or not on PATH`)
  }
  return binaryPath
}

async function runCliOrThrow(binaryPath, args, { runCli, timeoutMs }) {
  const result = await runCli(binaryPath, args, { timeoutMs })
  if (result.timedOut) {
    throw new Error(`\`${args.join(" ")}\` timed out`)
  }
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout || "")
      .trim()
      .split("\n")
      .slice(-3)
      .join("\n")
    throw new Error(
      `\`${args.join(" ")}\` exited with code ${result.code}${tail ? `: ${tail}` : ""}`
    )
  }
  return result
}

async function setClaudePluginEnabled(id, enabled, options = {}) {
  const { runCli = defaultRunCli } = options
  const pluginId = validateCliPluginId(id)
  const binaryPath = requireBinary("claude")
  await runCliOrThrow(
    binaryPath,
    ["plugin", enabled ? "enable" : "disable", pluginId],
    { runCli, timeoutMs: 30_000 }
  )
  invalidateCliPluginInventory()
}

async function claudePluginInstall(id, options = {}) {
  const { runCli = defaultRunCli } = options
  const pluginId = validateCliPluginId(id)
  const binaryPath = requireBinary("claude")
  await runCliOrThrow(binaryPath, ["plugin", "install", pluginId], {
    runCli,
    timeoutMs: 180_000,
  })
  invalidateCliPluginInventory()
}

async function claudePluginUninstall(id, options = {}) {
  const { runCli = defaultRunCli } = options
  const pluginId = validateCliPluginId(id)
  const binaryPath = requireBinary("claude")
  await runCliOrThrow(binaryPath, ["plugin", "uninstall", pluginId], {
    runCli,
    timeoutMs: 60_000,
  })
  invalidateCliPluginInventory()
}

async function codexPluginAdd(name, options = {}) {
  const { runCli = defaultRunCli } = options
  const pluginName = validateCliPluginId(name)
  const binaryPath = requireBinary("codex")
  await runCliOrThrow(binaryPath, ["plugin", "add", pluginName], {
    runCli,
    timeoutMs: 180_000,
  })
  invalidateCliPluginInventory()
}

async function codexPluginRemove(name, options = {}) {
  const { runCli = defaultRunCli } = options
  const pluginName = validateCliPluginId(name)
  const binaryPath = requireBinary("codex")
  await runCliOrThrow(binaryPath, ["plugin", "remove", pluginName], {
    runCli,
    timeoutMs: 60_000,
  })
  invalidateCliPluginInventory()
}

/**
 * Pure string→string patch of `config.toml`: flip (or insert) the single
 * `enabled = ...` key inside the exact `[plugins."<id>"]` section, leaving
 * every other byte — comments, formatting, unrelated sections — untouched.
 * The Codex CLI has no enable/disable verb (only add/list/marketplace/
 * remove), so this file edit IS the official toggle mechanism.
 */
function patchCodexConfigTomlEnabled(tomlText, pluginId, enabled) {
  const eol = tomlText.includes("\r\n") ? "\r\n" : "\n"
  const lines = tomlText.split("\n")
  const headerPattern = new RegExp(
    `^\\[plugins\\."${pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"]\\s*$`
  )
  let sectionStart = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (headerPattern.test(lines[i].replace(/\r$/, ""))) {
      sectionStart = i
      break
    }
  }
  if (sectionStart < 0) {
    const separator =
      tomlText === "" ? "" : tomlText.endsWith("\n") ? eol : eol + eol
    return `${tomlText}${separator}[plugins."${pluginId}"]${eol}enabled = ${enabled}${eol}`
  }
  let sectionEnd = lines.length
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, "").trim().startsWith("[")) {
      sectionEnd = i
      break
    }
  }
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    const hadCr = lines[i].endsWith("\r")
    const bare = lines[i].replace(/\r$/, "")
    if (/^\s*enabled\s*=/.test(bare)) {
      lines[i] = `enabled = ${enabled}${hadCr ? "\r" : ""}`
      return lines.join("\n")
    }
  }
  const headerHadCr = lines[sectionStart].endsWith("\r")
  lines.splice(
    sectionStart + 1,
    0,
    `enabled = ${enabled}${headerHadCr ? "\r" : ""}`
  )
  return lines.join("\n")
}

/** Toggle a Codex plugin by atomically rewriting config.toml (tmp + rename, `.bak` kept). */
async function setCodexPluginEnabled(pluginId, enabled) {
  const validated = validateCliPluginId(pluginId)
  const configPath = path.join(resolveCodexHome(), "config.toml")
  let tomlText = ""
  let existing = false
  try {
    tomlText = readBoundedRegularFile(configPath, MAX_CLI_CONFIG_BYTES).toString("utf8")
    existing = true
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  const patched = patchCodexConfigTomlEnabled(tomlText, validated, enabled)
  if (patched === tomlText) return
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  if (existing) writePrivateAtomicText(`${configPath}.bak`, tomlText)
  writePrivateAtomicText(configPath, patched)
  invalidateCliPluginInventory()
}

function writePrivateAtomicText(target, contents) {
  const tmpPath = `${target}.tmp-${crypto.randomUUID()}`
  let descriptor
  let owned = false
  try {
    descriptor = fs.openSync(tmpPath, "wx", 0o600)
    owned = true
    fs.writeFileSync(descriptor, contents, "utf8")
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(tmpPath, target)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (owned) {
      try { fs.unlinkSync(tmpPath) } catch { /* renamed or already absent */ }
    }
  }
}

/**
 * Available-but-not-installed plugins. Claude: local marketplace snapshots
 * (`~/.claude/plugins/marketplaces/<name>/.claude-plugin/marketplace.json`).
 * Codex: `codex plugin list --json --available`.
 */
async function getAvailableCliPlugins(options = {}) {
  const { runCli = defaultRunCli } = options
  const inventory = await getCliPluginInventory({ runCli })
  const installedIds = new Set([
    ...inventory.claude.plugins.map((plugin) => plugin.id),
    ...inventory.codex.plugins.map((plugin) => plugin.id),
  ])

  const claude = []
  const marketplacesDir = path.join(
    resolveClaudeConfigDir(),
    "plugins",
    "marketplaces"
  )
  for (const marketplaceDirName of listDirs(marketplacesDir)) {
    const manifest = readJson(
      path.join(
        marketplacesDir,
        marketplaceDirName,
        ".claude-plugin",
        "marketplace.json"
      )
    )
    if (!manifest || typeof manifest !== "object") continue
    const marketplaceName =
      typeof manifest.name === "string" && manifest.name
        ? manifest.name
        : marketplaceDirName
    const entries = Array.isArray(manifest.plugins) ? manifest.plugins : []
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.name !== "string"
      ) {
        continue
      }
      const id = `${entry.name}@${marketplaceName}`
      if (installedIds.has(id)) continue
      claude.push({
        source: "claude",
        id,
        name: entry.name,
        marketplace: marketplaceName,
        version: "unknown",
        scope: "user",
        enabled: false,
        installPath: "",
        ...(typeof entry.description === "string"
          ? { description: entry.description }
          : {}),
        ...(typeof entry.homepage === "string"
          ? { homepage: entry.homepage }
          : {}),
        ...(typeof entry.category === "string"
          ? { interface: { category: entry.category } }
          : {}),
        components: emptyComponents(),
      })
    }
  }

  let codex = []
  const codexBinary = resolveCliBinary("codex")
  if (codexBinary) {
    try {
      const result = await runCli(
        codexBinary,
        ["plugin", "list", "--json", "--available"],
        { timeoutMs: 30_000 }
      )
      if (!result.timedOut && result.code === 0) {
        const parsed = parseCodexPluginListJson(result.stdout)
        codex = parsed.available.filter(
          (plugin) => !installedIds.has(plugin.id)
        )
      }
    } catch {
      // available list is best-effort
    }
  }

  return { claude, codex }
}

module.exports = {
  getCliPluginInventory,
  invalidateCliPluginInventory,
  getAvailableCliPlugins,
  // mutations
  setClaudePluginEnabled,
  claudePluginInstall,
  claudePluginUninstall,
  codexPluginAdd,
  codexPluginRemove,
  setCodexPluginEnabled,
  // pure helpers (unit-tested)
  parseClaudeInstalledPlugins,
  readClaudePluginComponents,
  readCodexPluginComponents,
  parseCodexPluginListJson,
  parseCodexConfigTomlPlugins,
  patchCodexConfigTomlEnabled,
  validateCliPluginId,
  normalizeWindowsInstallPath,
  parseSkillFrontmatter,
  isClaudePluginEnabled,
  splitPluginId,
  resolveClaudeConfigDir,
  resolveCodexHome,
}
