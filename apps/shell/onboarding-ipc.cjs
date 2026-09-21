/**
 * Onboarding wizard IPC + CLI auto-sync + rules.
 *
 * This module used to be the 900-line catch-all that also owned MCP,
 * skills, hooks, and subagents. Those now live in their own `*-ipc.cjs`
 * files; this file is strictly the onboarding UX surface plus the bits
 * that cut across multiple feature areas: `cli:auto-sync` (scans the
 * Claude + Codex config dirs and imports anything the user doesn't
 * already have) and `rules:get/save` (a single markdown blob shared
 * across providers, kept here because it's tiny and wizard-adjacent).
 */

const { ipcMain } = require("electron")
const fs = require("fs")
const path = require("path")
const { scanClaude, scanCodex } = require("./cli-scanner.cjs")
const { IpcChannel } = require("./shared/ipc-contract.cjs")
const { ok, fail } = require("./shared/ipc-envelope.cjs")
const jsonFs = require("./shared/json-fs.cjs")
const {
  getBaseDir,
  getDoneFlag,
  getRuntimePaths,
  ensureDir,
  slugify,
} = require("./shared/runtime-paths.cjs")
const { readMcps, writeMcps, normalizeMcpConfig } = require("./mcp-ipc.cjs")
const { listSkillDirs, importScannedSkills } = require("./skills-ipc.cjs")
const { listSubagentDirs, importScannedAgents } = require("./subagents-ipc.cjs")
const { fetchJson } = require("./shared/fetch-json.cjs")
const { getBackendConnection } = require("./shared/backend-endpoint.cjs")

function readRules() {
  const { rulesFile } = getRuntimePaths()
  return jsonFs.readText(rulesFile, "", { warn: "onboarding-ipc" })
}

function writeRules(content) {
  const { rulesFile } = getRuntimePaths()
  jsonFs.writeText(rulesFile, content || "")
}

async function readBackendWorkspaceTrust(projectPath) {
  const cfg = getBackendConnection()
  if (!cfg) return null
  try {
    const payload = await fetchJson(
      `http://127.0.0.1:${cfg.port}/api/v1/permissions/workspace-trust/get`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspacePath: projectPath }),
      },
      { timeoutMs: 5_000 },
    )
    const trust = payload?.trust
    if (!trust || typeof trust !== "object" || Array.isArray(trust)) return null
    if (trust.state !== "trusted" && trust.state !== "untrusted") return null
    return trust
  } catch {
    return null
  }
}

async function resolveCliScanContext(request, dependencies = {}) {
  const rawProjectPath =
    request &&
    typeof request === "object" &&
    !Array.isArray(request) &&
    typeof request.projectPath === "string"
      ? request.projectPath.trim()
      : ""
  if (!rawProjectPath) {
    // Never infer a workspace from the Electron process cwd. With no selected
    // project, scanning intentionally remains user-global.
    return {
      scanOptions: { workspaceTrusted: false },
      projectScope: {
        status: "not-selected",
        projectPath: null,
        workspaceTrusted: false,
      },
    }
  }
  if (
    rawProjectPath.length > 4_096 ||
    rawProjectPath.includes("\0") ||
    !path.isAbsolute(rawProjectPath)
  ) {
    return {
      scanOptions: { workspaceTrusted: false },
      projectScope: {
        status: "invalid",
        projectPath: null,
        workspaceTrusted: false,
      },
    }
  }

  const projectPath = path.resolve(rawProjectPath)
  try {
    if (!fs.statSync(projectPath).isDirectory()) {
      throw new Error("Project root is not a directory")
    }
  } catch {
    return {
      scanOptions: { workspaceTrusted: false },
      projectScope: {
        status: "unavailable",
        projectPath,
        workspaceTrusted: false,
      },
    }
  }

  // The renderer used to forward its own copy of the trust bit. A compromised
  // page could mark an explicitly untrusted workspace as trusted and import
  // that folder's MCP commands. The backend record is the decision.
  const readTrust = dependencies.readWorkspaceTrust || readBackendWorkspaceTrust
  let trust = null
  try {
    trust = await readTrust(projectPath)
  } catch {
    trust = null
  }
  const workspaceTrusted = trust?.state === "trusted"
  return {
    scanOptions: {
      cwd: projectPath,
      projectRoot: projectPath,
      workspaceTrusted,
    },
    projectScope: {
      status: workspaceTrusted ? "trusted" : "untrusted",
      projectPath,
      workspaceTrusted,
    },
  }
}

async function scanCliAssets(request, dependencies = {}) {
  const { scanOptions, projectScope } = await resolveCliScanContext(request, dependencies)
  const scanClaudeImpl = dependencies.scanClaude || scanClaude
  const scanCodexImpl = dependencies.scanCodex || scanCodex
  return {
    claude: scanClaudeImpl(scanOptions),
    codex: scanCodexImpl(scanOptions),
    projectScope,
  }
}

/**
 * Scan CLI configs and import NEW servers/skills/agents that are not
 * yet present in the BetterC0de runtime config. Never removes
 * user-configured items — only adds. Deduplicates MCP servers by both
 * id and transport identity (same command/args or URL under a renamed id);
 * skills and agents dedupe by id only.
 */
async function cliAutoSync(scanRequest) {
  const { claude, codex, projectScope } = await scanCliAssets(scanRequest)

  const allScannedMcpServers = [
    ...(claude.mcpServers || []),
    ...(codex.mcpServers || []),
  ]
  const allScannedSkills = [...(claude.skills || []), ...(codex.skills || [])]
  const allScannedAgents = [...(claude.agents || []), ...(codex.agents || [])]

  // ── MCP Servers: deduplicate by id AND command ──
  const existingMcps = readMcps()
  const existingIds = new Set(existingMcps.map((m) => m.id))
  const existingTransports = new Set(
    existingMcps.map(mcpTransportIdentity).filter(Boolean)
  )

  const newMcpServers = allScannedMcpServers.filter((server) => {
    const transport = mcpTransportIdentity(server)
    const id = slugify(server.id || server.name)
    if (existingIds.has(id) || (transport && existingTransports.has(transport))) {
      return false
    }
    existingIds.add(id)
    if (transport) existingTransports.add(transport)
    return true
  })

  if (newMcpServers.length > 0) {
    const normalized = newMcpServers.map(normalizeMcpConfig)
    writeMcps([...existingMcps, ...normalized])
  }

  // ── Skills: deduplicate by id ──
  const existingSkillIds = new Set(listSkillDirs())
  const newSkills = allScannedSkills.filter(
    (s) => !existingSkillIds.has(slugify(s.id || s.name))
  )
  if (newSkills.length > 0) {
    importScannedSkills(newSkills)
  }

  // ── Agents / Subagents: deduplicate by id ──
  const existingAgentIds = new Set(listSubagentDirs())
  const newAgents = allScannedAgents.filter(
    (a) => !existingAgentIds.has(slugify(a.id || a.name))
  )
  if (newAgents.length > 0) {
    importScannedAgents(newAgents)
  }

  return {
    imported: {
      mcpServers: newMcpServers.length,
      skills: newSkills.length,
      agents: newAgents.length,
    },
    total: {
      mcpServers: allScannedMcpServers.length,
      skills: allScannedSkills.length,
      agents: allScannedAgents.length,
    },
    projectScope,
  }
}

function mcpTransportIdentity(server) {
  const command =
    typeof server?.command === "string" ? server.command.trim() : ""
  if (command) {
    const args = Array.isArray(server.args)
      ? server.args.filter((arg) => typeof arg === "string")
      : []
    return `command:${command}\0${args.join("\0")}`
  }
  const url = typeof server?.url === "string" ? server.url.trim() : ""
  return url ? `url:${url}` : ""
}

async function projectScopeForFailure(scanRequest) {
  try {
    return (await resolveCliScanContext(scanRequest)).projectScope
  } catch {
    return {
      status: "unavailable",
      projectPath: null,
      workspaceTrusted: false,
    }
  }
}

let registered = false

function registerOnboardingHandlers() {
  if (registered) return
  registered = true

  ipcMain.handle(IpcChannel.OnboardingIsDone, async () =>
    fs.existsSync(getDoneFlag())
  )

  ipcMain.handle(IpcChannel.OnboardingScan, async (_event, scanRequest) => {
    try {
      return ok(await scanCliAssets(scanRequest))
    } catch (e) {
      const projectScope = await projectScopeForFailure(scanRequest)
      return fail(e, {
        claude: {
          found: false,
          plugins: [],
          mcpServers: [],
          skills: [],
          agents: [],
          commands: [],
          skippedMcpServers: [],
          configSources: [],
        },
        codex: {
          found: false,
          plugins: [],
          mcpServers: [],
          skills: [],
          agents: [],
          commands: [],
          skippedMcpServers: [],
          configSources: [],
        },
        projectScope,
      })
    }
  })

  ipcMain.handle(
    IpcChannel.OnboardingImport,
    async (_, payload) => {
      const { mcpServers, skills, plugins, agents } =
        payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
      try {
        const { baseDir, pluginsFile } = getRuntimePaths()
        ensureDir(baseDir)
        writeMcps((mcpServers || []).map(normalizeMcpConfig))
        importScannedSkills(skills || [])
        importScannedAgents(agents || [])
        jsonFs.writeJson(pluginsFile, plugins || [])
        return ok()
      } catch (e) {
        return fail(e)
      }
    }
  )

  ipcMain.handle(IpcChannel.OnboardingComplete, async () => {
    try {
      ensureDir(getBaseDir())
      fs.writeFileSync(getDoneFlag(), new Date().toISOString())
      return ok()
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(IpcChannel.OnboardingReset, async () => {
    try {
      if (fs.existsSync(getDoneFlag())) fs.unlinkSync(getDoneFlag())
      return ok()
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(IpcChannel.CliAutoSync, async (_event, scanRequest) => {
    try {
      return ok(await cliAutoSync(scanRequest))
    } catch (e) {
      const projectScope = await projectScopeForFailure(scanRequest)
      return fail(e, {
        imported: { mcpServers: 0, skills: 0, agents: 0 },
        total: { mcpServers: 0, skills: 0, agents: 0 },
        projectScope,
      })
    }
  })

  ipcMain.handle(IpcChannel.RulesGet, async () => ({ content: readRules() }))

  ipcMain.handle(IpcChannel.RulesSave, async (_, content) => {
    try {
      writeRules(typeof content === "string" ? content : content?.content || "")
      return ok()
    } catch (e) {
      return fail(e)
    }
  })

  console.log("[onboarding-ipc] Handlers registered")
}

module.exports = {
  registerOnboardingHandlers,
  resolveCliScanContext,
  scanCliAssets,
}
