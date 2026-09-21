/**
 * Subagents IPC — named prompt templates the user can invoke as
 * lightweight specialist agents. Parses Codex-style `*.toml` agent
 * definitions for the import path.
 */

const fs = require("fs")
const path = require("path")
const { IpcChannel } = require("./shared/ipc-contract.cjs")
const { safeHandle, rawHandle } = require("./shared/ipc-handlers-factory.cjs")
const {
  readJson,
  writeJson,
  readText,
  writeText,
} = require("./shared/json-fs.cjs")
const { assertPathContained } = require("./shared/security-checks.cjs")
const {
  getRuntimePaths,
  ensureDir,
  slugify,
} = require("./shared/runtime-paths.cjs")

/**
 * Minimal TOML-ish parser tailored to Codex agent files. Pulls out the
 * three keys we care about — name, description, developer_instructions —
 * without dragging in a full TOML library. If Codex ever ships a richer
 * schema, swap to `@iarna/toml`.
 */
function parseCodexAgentToml(agentPath) {
  const content = readText(agentPath, "", { warn: "subagents-ipc" })
  if (!content) return null

  const matchValue = (pattern) => {
    const match = content.match(pattern)
    return match ? match[1].trim() : ""
  }

  const promptMatch = content.match(
    /developer_instructions\s*=\s*"""([\s\S]*?)"""/m
  )
  const fallbackId = path.basename(agentPath, path.extname(agentPath))

  return {
    id: slugify(matchValue(/^name\s*=\s*"([^"]+)"/m) || fallbackId),
    name: matchValue(/^name\s*=\s*"([^"]+)"/m) || fallbackId,
    description: matchValue(/^description\s*=\s*"([^"]+)"/m),
    prompt: promptMatch ? promptMatch[1].trim() : "",
    sourcePath: agentPath,
    source: "codex",
  }
}

function parseMarkdownAgent(agentPath, source = "claude") {
  const content = readText(agentPath, "", { warn: "subagents-ipc" })
  if (!content) return null

  let body = content
  const metadata = {}
  if (content.startsWith("---")) {
    const end = content.search(/\r?\n---(?:\r?\n|$)/)
    if (end >= 0) {
      for (const line of content.slice(3, end).split(/\r?\n/)) {
        const match = line.match(/^(name|description)\s*:\s*(.+?)\s*$/)
        if (!match) continue
        metadata[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
      }
      const closing = content.slice(end).match(/^\r?\n---(?:\r?\n|$)/)?.[0]
      body = content.slice(end + (closing?.length || 0)).trim()
    }
  }

  const fallbackId = path.basename(agentPath, path.extname(agentPath))
  const name = metadata.name || fallbackId
  return {
    id: slugify(name || fallbackId),
    name,
    description: metadata.description || "",
    prompt: body,
    sourcePath: agentPath,
    source,
  }
}

function parseScannedAgent(agent) {
  if (!agent?.path || !fs.existsSync(agent.path)) return null
  return path.extname(agent.path).toLowerCase() === ".toml"
    ? parseCodexAgentToml(agent.path)
    : parseMarkdownAgent(agent.path, agent.source || "import")
}

function listSubagentDirs() {
  const { subagentsDir } = getRuntimePaths()
  ensureDir(subagentsDir)
  return fs
    .readdirSync(subagentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function readSubagents() {
  const { subagentsDir } = getRuntimePaths()
  return listSubagentDirs()
    .map((name) => {
      try {
        const dir = path.join(subagentsDir, name)
        const manifest = readJson(path.join(dir, "manifest.json"), null, {
          warn: "subagents-ipc",
        })
        if (!manifest) return null
        const prompt = readText(path.join(dir, "prompt.md"), "", {
          warn: "subagents-ipc",
        })
        return {
          ...manifest,
          enabled: manifest.enabled !== false,
          prompt,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/** Persist a subagent into its per-id directory. Returns `{id}`; the IPC
 *  layer wraps that in the `{ok: true, ...}` envelope. */
function saveSubagent(data) {
  const { subagentsDir } = getRuntimePaths()
  const id = slugify(data.id || data.name)
  if (!id) throw new Error("Subagent id is required")
  const dir = path.join(subagentsDir, id)
  ensureDir(dir)

  const existing = readJson(
    path.join(dir, "manifest.json"),
    {},
    {
      warn: "subagents-ipc",
    }
  )
  const now = new Date().toISOString()
  const manifest = {
    id,
    name: data.name || existing.name || id,
    description: data.description ?? existing.description ?? "",
    enabled: data.enabled ?? existing.enabled ?? true,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    source: data.source || existing.source || "local",
    sourcePath: data.sourcePath || existing.sourcePath,
  }

  writeJson(path.join(dir, "manifest.json"), manifest)
  writeText(path.join(dir, "prompt.md"), data.prompt || existing.prompt || "")
  return { id }
}

function deleteSubagent(id) {
  const { subagentsDir } = getRuntimePaths()
  const safeId = slugify(id)
  if (!safeId) throw new Error("Invalid subagent id")
  const dir = assertPathContained(subagentsDir, safeId, "Subagent path")
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

function importScannedAgents(agents) {
  for (const agent of agents || []) {
    const parsed = parseScannedAgent(agent)
    saveSubagent({
      id: agent.id || parsed?.id || agent.name,
      name: parsed?.name || agent.name,
      description:
        parsed?.description || `Imported from ${agent.source || "scan"}`,
      prompt: parsed?.prompt || "",
      enabled: true,
      source: agent.source || parsed?.source || "import",
      sourcePath: agent.path || parsed?.sourcePath,
    })
  }
}

let registered = false

function registerSubagentsHandlers() {
  if (registered) return
  registered = true

  rawHandle(IpcChannel.SubagentList, async () => readSubagents(), {
    fallback: [],
    warnTag: "subagents-ipc",
  })

  safeHandle(IpcChannel.SubagentSave, async (_event, agent) =>
    saveSubagent(agent || {})
  )

  safeHandle(IpcChannel.SubagentDelete, async (_event, { id } = {}) => {
    deleteSubagent(id)
  })

  console.log("[subagents-ipc] Handlers registered")
}

module.exports = {
  registerSubagentsHandlers,
  listSubagentDirs,
  importScannedAgents,
  parseCodexAgentToml,
  parseMarkdownAgent,
  parseScannedAgent,
}
