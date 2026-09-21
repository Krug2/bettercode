/**
 * MCP server IPC handlers. Installs, enables, removes, and probe-spawns
 * Model-Context-Protocol servers configured by the user.
 *
 * SECURITY: `probeMcp` spawns an arbitrary binary chosen by the renderer,
 * so it always shows a confirmation dialog (unless `requireConfirm: false`)
 * with the command + args preview. `shell: false` prevents shell expansion
 * but does not validate the binary — that's the user's call.
 */

const { dialog } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { IpcChannel } = require("./shared/ipc-contract.cjs")
const { safeHandle, rawHandle } = require("./shared/ipc-handlers-factory.cjs")
const { createArrayPersistAdapter } = require("./shared/persist-adapter.cjs")
const appConfig = require("./shared/appConfig.cjs")
const { runCli } = require("./shared/spawn-cli.cjs")
const {
  getBaseDir,
  getRuntimePaths,
  slugify,
  getFocusedWindow,
} = require("./shared/runtime-paths.cjs")

const MAX_MCP_ENTRIES = 128
const MAX_MCP_NAME_CHARS = 256
const MAX_MCP_COMMAND_CHARS = 4_096
const MAX_MCP_ARGS = 32
const MAX_MCP_ARG_CHARS = 2_048
const MAX_MCP_ARGS_CHARS = 16_384
const MAX_MCP_ENV_ENTRIES = 64
const MAX_MCP_ENV_VALUE_CHARS = 8_192
const MAX_MCP_ENV_CHARS = 65_536
const MAX_MCP_STORE_BYTES = 4 * 1024 * 1024
const MCP_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const MCP_HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/
const MCP_FORBIDDEN_ENV_KEYS = new Set([
  "BETTERC0DE_SETTINGS_KEY",
  "BASH_ENV",
  "ENV",
  "ELECTRON_RUN_AS_NODE",
  "LD_AUDIT",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
])

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedString(value, label, maxChars, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required`)
    return ""
  }
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  if (required && normalized.length === 0) {
    throw new Error(`${label} is required`)
  }
  if (normalized.length > maxChars) {
    throw new Error(`${label} exceeds ${maxChars} characters`)
  }
  return normalized
}

function normalizeMcpArgs(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error("MCP args must be an array")
  if (value.length > MAX_MCP_ARGS) {
    throw new Error(`MCP args exceed ${MAX_MCP_ARGS} entries`)
  }
  let total = 0
  return value.map((arg, index) => {
    if (typeof arg !== "string") {
      throw new Error(`MCP arg ${index + 1} must be a string`)
    }
    if (arg.length > MAX_MCP_ARG_CHARS) {
      throw new Error(
        `MCP arg ${index + 1} exceeds ${MAX_MCP_ARG_CHARS} characters`,
      )
    }
    total += arg.length
    if (total > MAX_MCP_ARGS_CHARS) {
      throw new Error(`MCP args exceed ${MAX_MCP_ARGS_CHARS} characters total`)
    }
    return arg
  })
}

function normalizeMcpEnv(value) {
  if (value === undefined || value === null) return {}
  if (!isPlainObject(value)) throw new Error("MCP env must be an object")
  const entries = Object.entries(value)
  if (entries.length > MAX_MCP_ENV_ENTRIES) {
    throw new Error(`MCP env exceeds ${MAX_MCP_ENV_ENTRIES} entries`)
  }
  let total = 0
  const normalized = {}
  for (const [key, rawValue] of entries) {
    const upper = key.toUpperCase()
    if (
      !MCP_ENV_KEY_RE.test(key) ||
      MCP_FORBIDDEN_ENV_KEYS.has(upper) ||
      upper.startsWith("DYLD_")
    ) {
      throw new Error(`Unsafe MCP environment key: ${key}`)
    }
    if (typeof rawValue !== "string") {
      throw new Error(`MCP environment value for ${key} must be a string`)
    }
    if (rawValue.length > MAX_MCP_ENV_VALUE_CHARS) {
      throw new Error(
        `MCP environment value for ${key} exceeds ${MAX_MCP_ENV_VALUE_CHARS} characters`,
      )
    }
    total += key.length + rawValue.length
    if (total > MAX_MCP_ENV_CHARS) {
      throw new Error(`MCP env exceeds ${MAX_MCP_ENV_CHARS} characters total`)
    }
    normalized[key] = rawValue
  }
  return normalized
}

function normalizeMcpHeaders(value, { environmentReferences = false } = {}) {
  if (value === undefined || value === null) return {}
  if (!isPlainObject(value)) {
    throw new Error(
      environmentReferences
        ? "MCP environment-backed headers must be an object"
        : "MCP headers must be an object",
    )
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_MCP_ENV_ENTRIES) {
    throw new Error(`MCP headers exceed ${MAX_MCP_ENV_ENTRIES} entries`)
  }
  let total = 0
  const normalizedEntries = []
  for (const [name, rawValue] of entries) {
    if (!MCP_HTTP_HEADER_NAME_RE.test(name)) {
      throw new Error(`Invalid MCP HTTP header name: ${name}`)
    }
    if (typeof rawValue !== "string") {
      throw new Error(`MCP HTTP header value for ${name} must be a string`)
    }
    if (environmentReferences && !MCP_ENV_KEY_RE.test(rawValue)) {
      throw new Error(
        `MCP HTTP header environment reference for ${name} must be an environment variable name`,
      )
    }
    if (!environmentReferences && /[\0\r\n]/.test(rawValue)) {
      throw new Error(`MCP HTTP header value for ${name} contains a newline`)
    }
    if (rawValue.length > MAX_MCP_ENV_VALUE_CHARS) {
      throw new Error(
        `MCP HTTP header value for ${name} exceeds ${MAX_MCP_ENV_VALUE_CHARS} characters`,
      )
    }
    total += name.length + rawValue.length
    if (total > MAX_MCP_ENV_CHARS) {
      throw new Error(
        `MCP headers exceed ${MAX_MCP_ENV_CHARS} characters total`,
      )
    }
    normalizedEntries.push([name, rawValue])
  }
  return Object.fromEntries(normalizedEntries)
}

/**
 * S2: resolve a renderer-supplied `command` to an absolute file path before
 * we hand it to `spawn`. Without this, a relative name like `node` is looked
 * up via `PATH` at spawn time — a planted shim earlier in the user's PATH
 * gets RCE on every probe. We resolve once, show the resolved path in the
 * confirmation dialog, and refuse to launch if the resolution fails.
 *
 * Returns null if the command cannot be resolved to a real file.
 */
function resolveCommandToAbsolute(command) {
  if (typeof command !== "string" || command.trim().length === 0) return null
  const trimmed = command.trim()

  // Absolute paths are vetted with a stat call below.
  if (path.isAbsolute(trimmed)) {
    return canonicalRegularExecutable(trimmed)
  }

  // Reject paths with separators that aren't absolute — those are relative
  // file references, which are even more dangerous than bare names because
  // they depend on the current working directory.
  if (trimmed.includes("/") || trimmed.includes("\\")) return null

  // Walk PATH manually so we can be deterministic (Node's spawn does this
  // implicitly, but we need to know the resolved path for the dialog).
  const isWin = process.platform === "win32"
  const pathSep = isWin ? ";" : ":"
  const pathExt = isWin
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase())
    : [""]
  const dirs = (process.env.PATH || "")
    .split(pathSep)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean)
    .slice(0, 256)
  for (const dir of dirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, trimmed + ext)
      const canonical = canonicalRegularExecutable(candidate)
      if (canonical) return canonical
    }
  }
  return null
}

function canonicalRegularExecutable(p) {
  try {
    const canonical = fs.realpathSync.native(p)
    const st = fs.lstatSync(canonical)
    if (!st.isFile() || st.isSymbolicLink()) return null
    if (process.platform !== "win32") {
      fs.accessSync(canonical, fs.constants.X_OK)
    }
    return path.normalize(canonical)
  } catch {
    return null
  }
}

function normalizeMcpConfig(config, { requireIdentity = true } = {}) {
  if (!isPlainObject(config)) throw new Error("MCP config must be an object")
  const rawName =
    config.name ??
    config.id ??
    (requireIdentity ? undefined : config.command)
  const name = boundedString(
    rawName,
    "MCP name",
    MAX_MCP_NAME_CHARS,
    { required: requireIdentity },
  )
  const id = slugify(config.id || name || "mcp-probe")
  if (!id) throw new Error("MCP id/name must contain letters or numbers")
  const type = boundedString(config.type ?? "command", "MCP type", 32, {
    required: true,
  })
  const command = boundedString(
    config.command,
    "MCP command",
    MAX_MCP_COMMAND_CHARS,
  )
  const url = boundedString(config.url, "MCP URL", 4_096)
  if (type === "command" && !command) {
    throw new Error("MCP command is required for command servers")
  }
  if (type !== "command" && !command && !url) {
    throw new Error("MCP command or URL is required")
  }
  // Older runtime stores used `env` for remote static headers. Keep that
  // representation readable while new imports use the explicit `headers`.
  const env =
    type === "command"
      ? normalizeMcpEnv(config.env)
      : normalizeMcpHeaders(config.env)
  const headers =
    config.headers === undefined
      ? undefined
      : normalizeMcpHeaders(config.headers)
  const headerEnv =
    config.headerEnv === undefined
      ? undefined
      : normalizeMcpHeaders(config.headerEnv, {
          environmentReferences: true,
        })
  if (
    type === "command" &&
    ((headers && Object.keys(headers).length > 0) ||
      (headerEnv && Object.keys(headerEnv).length > 0))
  ) {
    throw new Error("MCP HTTP headers require a remote MCP transport")
  }
  return {
    id,
    name,
    command,
    args: normalizeMcpArgs(config.args),
    env,
    ...(headers === undefined ? {} : { headers }),
    ...(headerEnv === undefined ? {} : { headerEnv }),
    enabled: config.enabled !== false,
    installedAt:
      boundedString(config.installedAt, "MCP installedAt", 128) ||
      new Date().toISOString(),
    type,
    url: url || null,
    authenticated: !!config.authenticated,
  }
}

const mcpStore = createArrayPersistAdapter({
  filePath: () => getRuntimePaths().mcpFile,
  warnTag: "mcp-ipc",
  maxItems: MAX_MCP_ENTRIES,
  maxBytes: MAX_MCP_STORE_BYTES,
  buildEntry: (input, existing) => {
    // Merge existing fields with the new normalized config so partial
    // installs (re-installing an existing server) don't drop unrelated
    // fields the caller didn't touch.
    const normalized = normalizeMcpConfig(input)
    return existing ? { ...existing, ...normalized } : normalized
  },
})

function executableIdentity(filePath) {
  const canonical = canonicalRegularExecutable(filePath)
  if (!canonical) return null
  const stat = fs.statSync(canonical)
  return {
    path: canonical,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

function sameExecutableIdentity(left, right) {
  return (
    !!left &&
    !!right &&
    left.path === right.path &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  )
}

function mcpConfirmationDetail(server, resolvedCommand) {
  const args = server.args.map((arg, index) => `${index + 1}. ${JSON.stringify(arg)}`)
  const envNames = Object.keys(server.env).sort()
  // The arguments listed here are the ones the child actually receives:
  // `quoteWindowsCmdArg` now escapes the cmd layer correctly, so the displayed
  // value and the delivered argv agree. The one remaining divergence is `%`,
  // which cmd expands from the environment before caret processing — call it
  // out rather than showing text that will not be what runs.
  const percentArgs =
    process.platform === "win32"
      ? server.args.filter((arg) => typeof arg === "string" && arg.includes("%"))
      : []
  return [
    `Command: ${JSON.stringify(server.command)}`,
    ...(resolvedCommand !== server.command
      ? [`Resolved: ${JSON.stringify(resolvedCommand)}`]
      : []),
    `Arguments (${server.args.length}):`,
    ...(args.length > 0 ? args : ["(none)"]),
    `Environment keys (${envNames.length}; values hidden):`,
    ...(envNames.length > 0 ? envNames : ["(none)"]),
    ...(percentArgs.length > 0
      ? [
          "",
          `Warning: ${percentArgs.length} argument(s) contain "%". Windows may substitute an environment variable there, so the value that runs can differ from the value shown.`,
        ]
      : []),
    "",
    "This launches an arbitrary binary on your machine. Only proceed for MCP servers you trust.",
  ].join("\n")
}

async function probeMcp(config, { requireConfirm = true } = {}) {
  let server
  try {
    server = normalizeMcpConfig(config || {}, { requireIdentity: false })
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
  if (!server.command) return { ok: false, error: "Missing command" }

  // S2: resolve the binary to an absolute path NOW, before any user prompt.
  // The dialog shows the resolved path so the user can see exactly which
  // binary they're approving — `node` getting hijacked by a planted shim on
  // PATH is the threat we're closing here.
  const resolvedCommand = resolveCommandToAbsolute(server.command)
  if (!resolvedCommand) {
    return {
      ok: false,
      error: `Refusing to launch MCP server "${server.name || server.id}": command "${server.command}" could not be resolved to a file on disk.`,
    }
  }
  const approvedIdentity = executableIdentity(resolvedCommand)
  if (!approvedIdentity) {
    return { ok: false, error: "Resolved MCP command is no longer executable" }
  }

  if (requireConfirm) {
    const win = getFocusedWindow()
    const confirm = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Launch MCP server?",
      message: `Start MCP server ${JSON.stringify(server.name || server.id)}?`,
      detail: mcpConfirmationDetail(server, resolvedCommand),
      buttons: ["Cancel", "Launch"],
      defaultId: 0,
      cancelId: 0,
    })
    if (confirm.response !== 1) {
      return { ok: false, error: "User cancelled" }
    }
  }

  const launchIdentity = executableIdentity(resolvedCommand)
  if (!sameExecutableIdentity(approvedIdentity, launchIdentity)) {
    return {
      ok: false,
      error:
        "The MCP command changed after it was approved. Review the command and try again.",
    }
  }

  try {
    const result = await runCli(resolvedCommand, server.args || [], {
      env: server.env || {},
      cwd: getBaseDir(),
      timeoutMs: appConfig.MCP_PROBE_TIMEOUT_MS,
      maxOutputBytes: appConfig.MCP_OUTPUT_MAX_CHARS * 4,
    })
    const response = {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      code: result.code,
      signal: result.signal,
      processTreeVerified: result.processTreeVerified,
    }
    if (result.timedOut) {
      return {
        ok: true,
        ...response,
        note: "Process launched successfully and its process tree was stopped after the probe timeout.",
      }
    }
    if (result.code === 0) {
      return {
        ok: true,
        ...response,
        ...(result.processTreeVerified === false
          ? {
              note:
                "The MCP launcher exited, but Windows cannot prove that it left no detached descendants without Job Object support.",
            }
          : {}),
      }
    }
    return {
      ok: false,
      ...response,
      error:
        response.stderr ||
        response.stdout ||
        `Process exited with code ${result.code}`,
    }
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: error?.message || String(error),
    }
  }

}

let registered = false

function registerMcpHandlers() {
  if (registered) return
  registered = true

  rawHandle(IpcChannel.McpList, async () => mcpStore.list(), {
    fallback: [],
    warnTag: "mcp-ipc",
  })

  safeHandle(IpcChannel.McpInstall, async (_event, config) => {
    const normalized = normalizeMcpConfig(config || {})
    const entry = mcpStore.save(normalized)
    return { id: entry.id }
  })

  safeHandle(IpcChannel.McpRemove, async (_event, { id } = {}) => {
    const normalizedId = slugify(
      boundedString(id, "MCP id", 128, { required: true }),
    )
    if (!normalizedId) throw new Error("MCP id is required")
    mcpStore.remove(normalizedId)
  })

  safeHandle(IpcChannel.McpUpdateEnv, async (_event, { id, env } = {}) => {
    const normalizedId = slugify(
      boundedString(id, "MCP id", 128, { required: true }),
    )
    const patch = normalizeMcpEnv(env)
    const updated = mcpStore.update(normalizedId, (mcp) =>
      normalizeMcpConfig({
        ...mcp,
        env: normalizeMcpEnv({ ...(mcp.env || {}), ...patch }),
      }),
    )
    if (!updated) throw new Error(`MCP server not found: ${normalizedId}`)
  })

  safeHandle(IpcChannel.McpSetEnabled, async (_event, { id, enabled } = {}) => {
    if (typeof enabled !== "boolean") {
      throw new Error("MCP enabled state must be a boolean")
    }
    const normalizedId = slugify(
      boundedString(id, "MCP id", 128, { required: true }),
    )
    const updated = mcpStore.update(normalizedId, (mcp) =>
      normalizeMcpConfig({ ...mcp, enabled }),
    )
    if (!updated) throw new Error(`MCP server not found: ${normalizedId}`)
  })

  safeHandle(IpcChannel.McpProbe, async (_event, config) => {
    // probeMcp returns its own envelope-like object — passthrough via safeHandle.
    return probeMcp(config || {})
  })

  console.log("[mcp-ipc] Handlers registered")
}

module.exports = {
  registerMcpHandlers,
  readMcps: () => mcpStore.list(),
  writeMcps: (mcps) => {
    if (!Array.isArray(mcps) || mcps.length > MAX_MCP_ENTRIES) {
      throw new Error(`MCP list exceeds ${MAX_MCP_ENTRIES} entries`)
    }
    mcpStore.replaceAll(mcps.map((entry) => normalizeMcpConfig(entry)))
  },
  normalizeMcpConfig,
  normalizeMcpEnv,
  normalizeMcpHeaders,
  mcpConfirmationDetail,
  probeMcp,
  resolveCommandToAbsolute,
}
