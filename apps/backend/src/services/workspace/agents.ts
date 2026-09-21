import fs from "node:fs/promises"
import path from "node:path"
import { safeResolveInside } from "./files"
import {
  PROJECT_COMMAND_MAX_BYTES,
  readBoolean,
  readUnknownRecord,
} from "./formatters"
import {
  projectAgentPermissionRules,
  readBooleanRecord,
  type ProjectPermissionRuleTemplate,
} from "./permissions"
import {
  isBetterC0deProjectConfigDisabled,
  parseBooleanScalar,
  readBetterC0deProjectConfigs,
  readRecord,
} from "./project-config"
import { readFiniteNumber, readPositiveInteger, readString } from "./providers"
import {
  betterC0deConfigSubdirSources,
  collectedFileSourcePath,
  parseSimpleFrontmatter,
  PROJECT_COMMAND_MAX_DEPTH,
  PROJECT_COMMAND_MAX_FILES,
  stripYamlScalarQuotes,
} from "./resources"

export interface ProjectCommandTemplate {
  name: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  sourcePath: string
  template: string
}

export interface ProjectAgentTemplate {
  id: string
  name: string
  description?: string
  enabled: boolean
  hidden?: boolean
  mode?: string
  model?: string
  variant?: string
  temperature?: number
  topP?: number
  color?: string
  steps?: number
  tools: Record<string, boolean>
  optionKeys: string[]
  permissions: ProjectPermissionRuleTemplate[]
  sourcePath: string
  prompt: string
}

export async function listProjectCommands(
  cwd: string
): Promise<ProjectCommandTemplate[]> {
  const root = path.resolve(cwd)
  const byName = new Map<string, ProjectCommandTemplate>()

  for (const command of await listBetterC0deConfigCommands(root)) {
    byName.set(command.name, command)
  }

  for (const commandRoot of betterC0deConfigSubdirSources(root, [
    "command",
    "commands",
  ])) {
    await collectProjectCommands(
      root,
      commandRoot.absolutePath,
      commandRoot.sourcePath,
      byName
    )
  }

  if (!isBetterC0deProjectConfigDisabled()) {
    for (const commandRoot of [
      ".betterc0de/command",
      ".betterc0de/commands",
      ".BetterC0de/command",
      ".BetterC0de/commands",
    ]) {
      const absoluteRoot = safeResolveInside(root, commandRoot)
      await collectProjectCommands(root, absoluteRoot, commandRoot, byName)
    }
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )
}

export async function listProjectAgents(
  cwd: string
): Promise<ProjectAgentTemplate[]> {
  const root = path.resolve(cwd)
  const byId = new Map<string, ProjectAgentTemplate>()

  for (const agent of await listBetterC0deConfigAgents(root)) {
    byId.set(agent.id, agent)
  }

  for (const agentRoot of betterC0deConfigSubdirSources(root, [
    "agent",
    "agents",
  ])) {
    await collectProjectAgents(
      root,
      agentRoot.absolutePath,
      agentRoot.sourcePath,
      byId
    )
  }

  if (!isBetterC0deProjectConfigDisabled()) {
    for (const agentRoot of [
      ".betterc0de/agent",
      ".betterc0de/agents",
      ".BetterC0de/agent",
      ".BetterC0de/agents",
    ]) {
      const absoluteRoot = safeResolveInside(root, agentRoot)
      await collectProjectAgents(root, absoluteRoot, agentRoot, byId)
    }
  }

  for (const modeRoot of betterC0deConfigSubdirSources(root, [
    "mode",
    "modes",
  ])) {
    await collectProjectAgents(
      root,
      modeRoot.absolutePath,
      modeRoot.sourcePath,
      byId,
      {
        maxDepth: 0,
        modeOverride: "primary",
      }
    )
  }

  if (!isBetterC0deProjectConfigDisabled()) {
    for (const modeRoot of [
      ".betterc0de/mode",
      ".betterc0de/modes",
      ".BetterC0de/mode",
      ".BetterC0de/modes",
    ]) {
      const absoluteRoot = safeResolveInside(root, modeRoot)
      await collectProjectAgents(root, absoluteRoot, modeRoot, byId, {
        maxDepth: 0,
        modeOverride: "primary",
      })
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
  )
}

async function listBetterC0deConfigCommands(
  workspaceRoot: string
): Promise<ProjectCommandTemplate[]> {
  const commands: ProjectCommandTemplate[] = []
  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    workspaceRoot
  )) {
    const commandConfig = readRecord(config, "command")
    for (const [name, rawCommand] of Object.entries(commandConfig)) {
      if (
        !rawCommand ||
        typeof rawCommand !== "object" ||
        Array.isArray(rawCommand)
      ) {
        continue
      }
      const command = rawCommand as Record<string, unknown>
      const template = readString(command.template)
      if (!template) continue
      const description = readString(command.description)
      const agent = readString(command.agent)
      const model = readString(command.model)
      const subtask = readBoolean(command.subtask)
      commands.push({
        name,
        sourcePath: `${sourcePath}#command.${name}`,
        template,
        ...(description ? { description } : {}),
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
        ...(typeof subtask === "boolean" ? { subtask } : {}),
      })
    }
  }
  return commands
}

async function listBetterC0deConfigAgents(
  workspaceRoot: string
): Promise<ProjectAgentTemplate[]> {
  const agents: ProjectAgentTemplate[] = []
  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    workspaceRoot
  )) {
    agents.push(...projectAgentsFromConfigRecord(config, sourcePath, "agent"))
    agents.push(...projectAgentsFromConfigRecord(config, sourcePath, "mode"))
  }
  return agents
}

const BetterC0de_AGENT_KNOWN_KEYS = new Set([
  "name",
  "model",
  "variant",
  "prompt",
  "description",
  "temperature",
  "top_p",
  "mode",
  "hidden",
  "color",
  "steps",
  "maxSteps",
  "options",
  "permission",
  "disable",
  "tools",
])

function projectAgentsFromConfigRecord(
  config: unknown,
  sourcePath: string,
  key: "agent" | "mode"
): ProjectAgentTemplate[] {
  const out: ProjectAgentTemplate[] = []
  const agentConfig = readRecord(config, key)
  for (const [id, rawAgent] of Object.entries(agentConfig)) {
    if (!rawAgent || typeof rawAgent !== "object" || Array.isArray(rawAgent)) {
      continue
    }
    const agent = rawAgent as Record<string, unknown>
    const name = readString(agent.name) || id
    const description = readString(agent.description)
    const prompt =
      readString(agent.prompt) ||
      description ||
      `Follow the BetterC0de project agent configuration for ${name}.`
    const mode = key === "mode" ? "primary" : readString(agent.mode)
    const model = readString(agent.model)
    const baseSourcePath = `${sourcePath}#${key}.${id}`
    const variant = readString(agent.variant)
    const temperature = readFiniteNumber(agent.temperature)
    const topP = readFiniteNumber(agent.top_p)
    const color = readString(agent.color)
    const steps =
      readPositiveInteger(agent.steps) ?? readPositiveInteger(agent.maxSteps)
    const hidden = readBoolean(agent.hidden)
    const disabled = readBoolean(agent.disable) === true
    const tools = readBooleanRecord(agent.tools)
    out.push({
      id,
      name,
      enabled: !disabled,
      sourcePath: baseSourcePath,
      prompt,
      tools,
      optionKeys: projectAgentOptionKeys(agent),
      permissions: projectAgentPermissionRules(
        tools,
        agent.permission,
        baseSourcePath
      ),
      ...(description ? { description } : {}),
      ...(typeof hidden === "boolean" ? { hidden } : {}),
      ...(mode ? { mode } : {}),
      ...(model ? { model } : {}),
      ...(variant ? { variant } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(color ? { color } : {}),
      ...(steps !== undefined ? { steps } : {}),
    })
  }
  return out
}

function projectAgentOptionKeys(agent: Record<string, unknown>): string[] {
  const keys = new Set(Object.keys(readUnknownRecord(agent.options)))
  for (const key of Object.keys(agent)) {
    if (!BetterC0de_AGENT_KNOWN_KEYS.has(key)) keys.add(key)
  }
  return [...keys].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  )
}

async function collectProjectCommands(
  workspaceRoot: string,
  commandRoot: string,
  commandRootRelative: string,
  out: Map<string, ProjectCommandTemplate>
): Promise<void> {
  try {
    const stat = await fs.stat(commandRoot)
    if (!stat.isDirectory()) return
  } catch {
    return
  }

  let seen = 0
  async function walk(dir: string, depth: number): Promise<void> {
    if (
      depth > PROJECT_COMMAND_MAX_DEPTH ||
      seen >= PROJECT_COMMAND_MAX_FILES
    ) {
      return
    }

    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })

    for (const entry of entries) {
      if (seen >= PROJECT_COMMAND_MAX_FILES) return
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
        continue
      }

      let stat: import("node:fs").Stats
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size > PROJECT_COMMAND_MAX_BYTES) continue

      seen += 1
      const relativeFromRoot = path
        .relative(commandRoot, abs)
        .replace(/\\/g, "/")
      const commandName = relativeFromRoot.replace(/\.md$/i, "")
      if (!commandName || commandName.startsWith(".")) continue

      let content: string
      try {
        content = await fs.readFile(abs, "utf8")
      } catch {
        continue
      }
      const parsed = parseProjectCommandMarkdown(content)
      const sourcePath = collectedFileSourcePath(
        workspaceRoot,
        commandRoot,
        commandRootRelative,
        abs
      )
      out.set(commandName, {
        name: commandName,
        sourcePath,
        template: parsed.template,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.agent ? { agent: parsed.agent } : {}),
        ...(parsed.model ? { model: parsed.model } : {}),
        ...(typeof parsed.subtask === "boolean"
          ? { subtask: parsed.subtask }
          : {}),
      })
    }
  }

  await walk(commandRoot, 0)
}

async function collectProjectAgents(
  workspaceRoot: string,
  agentRoot: string,
  agentRootRelative: string,
  out: Map<string, ProjectAgentTemplate>,
  options: {
    maxDepth?: number
    modeOverride?: string
  } = {}
): Promise<void> {
  try {
    const stat = await fs.stat(agentRoot)
    if (!stat.isDirectory()) return
  } catch {
    return
  }

  let seen = 0
  const maxDepth = options.maxDepth ?? PROJECT_COMMAND_MAX_DEPTH
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || seen >= PROJECT_COMMAND_MAX_FILES) {
      return
    }

    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })

    for (const entry of entries) {
      if (seen >= PROJECT_COMMAND_MAX_FILES) return
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
        continue
      }

      let stat: import("node:fs").Stats
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size > PROJECT_COMMAND_MAX_BYTES) continue

      seen += 1
      const relativeFromRoot = path.relative(agentRoot, abs).replace(/\\/g, "/")
      const agentId = relativeFromRoot.replace(/\.md$/i, "")
      if (!agentId || agentId.startsWith(".")) continue

      let content: string
      try {
        content = await fs.readFile(abs, "utf8")
      } catch {
        continue
      }
      const parsed = parseProjectAgentMarkdown(content)
      const sourcePath = collectedFileSourcePath(
        workspaceRoot,
        agentRoot,
        agentRootRelative,
        abs
      )
      const name = parsed.name || agentId
      out.set(agentId, {
        id: agentId,
        name,
        enabled: parsed.disable !== true,
        sourcePath,
        prompt: parsed.prompt,
        tools: parsed.tools ?? {},
        optionKeys: parsed.optionKeys ?? [],
        permissions: projectAgentPermissionRules(
          parsed.tools ?? {},
          parsed.permission,
          sourcePath
        ),
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(typeof parsed.hidden === "boolean"
          ? { hidden: parsed.hidden }
          : {}),
        ...(options.modeOverride || parsed.mode
          ? { mode: options.modeOverride ?? parsed.mode }
          : {}),
        ...(parsed.model ? { model: parsed.model } : {}),
        ...(parsed.variant ? { variant: parsed.variant } : {}),
        ...(parsed.temperature !== undefined
          ? { temperature: parsed.temperature }
          : {}),
        ...(parsed.topP !== undefined ? { topP: parsed.topP } : {}),
        ...(parsed.color ? { color: parsed.color } : {}),
        ...(parsed.steps !== undefined ? { steps: parsed.steps } : {}),
      })
    }
  }

  await walk(agentRoot, 0)
}

function parseProjectCommandMarkdown(content: string): {
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  template: string
} {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) {
    return { template: normalized.trim() }
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized)
  if (!match) return { template: normalized.trim() }

  const frontmatter = parseSimpleFrontmatter(match[1] ?? "")
  return {
    template: (match[2] ?? "").trim(),
    ...(frontmatter.description
      ? { description: frontmatter.description }
      : {}),
    ...(frontmatter.agent ? { agent: frontmatter.agent } : {}),
    ...(frontmatter.model ? { model: frontmatter.model } : {}),
    ...(frontmatter.subtask !== undefined
      ? { subtask: frontmatter.subtask }
      : {}),
  }
}

function parseProjectAgentMarkdown(content: string): {
  name?: string
  description?: string
  disable?: boolean
  hidden?: boolean
  mode?: string
  model?: string
  variant?: string
  temperature?: number
  topP?: number
  color?: string
  steps?: number
  tools?: Record<string, boolean>
  optionKeys?: string[]
  permission?: unknown
  prompt: string
} {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) {
    return { prompt: normalized.trim() }
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized)
  if (!match) return { prompt: normalized.trim() }

  const frontmatter = parseProjectAgentFrontmatter(match[1] ?? "")
  return {
    prompt: (match[2] ?? "").trim(),
    ...(frontmatter.name ? { name: frontmatter.name } : {}),
    ...(frontmatter.description
      ? { description: frontmatter.description }
      : {}),
    ...(frontmatter.disable !== undefined
      ? { disable: frontmatter.disable }
      : {}),
    ...(frontmatter.hidden !== undefined ? { hidden: frontmatter.hidden } : {}),
    ...(frontmatter.mode ? { mode: frontmatter.mode } : {}),
    ...(frontmatter.model ? { model: frontmatter.model } : {}),
    ...(frontmatter.variant ? { variant: frontmatter.variant } : {}),
    ...(frontmatter.temperature !== undefined
      ? { temperature: frontmatter.temperature }
      : {}),
    ...(frontmatter.topP !== undefined ? { topP: frontmatter.topP } : {}),
    ...(frontmatter.color ? { color: frontmatter.color } : {}),
    ...(frontmatter.steps !== undefined ? { steps: frontmatter.steps } : {}),
    ...(Object.keys(frontmatter.tools).length > 0
      ? { tools: frontmatter.tools }
      : {}),
    ...(frontmatter.optionKeys.length > 0
      ? { optionKeys: frontmatter.optionKeys }
      : {}),
    ...(frontmatter.permission ? { permission: frontmatter.permission } : {}),
  }
}

function parseProjectAgentFrontmatter(input: string): ReturnType<
  typeof parseSimpleFrontmatter
> & {
  tools: Record<string, boolean>
  optionKeys: string[]
  permission?: unknown
} {
  const scalar = parseSimpleFrontmatter(input)
  const tools: Record<string, boolean> = {}
  const optionKeys = new Set<string>()
  const permission: Record<string, unknown> = {}
  let currentTop: string | null = null
  let currentPermission: string | null = null

  for (const line of input.split(/\r?\n/g)) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const top = /^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line)
    if (top) {
      const key = top[1]?.trim()
      const normalized = key?.toLowerCase() ?? ""
      const rawValue = stripYamlScalarQuotes(top[2] ?? "")
      currentTop = null
      currentPermission = null
      if (
        (normalized === "tools" ||
          normalized === "options" ||
          normalized === "permission") &&
        !rawValue
      ) {
        currentTop = normalized
        continue
      }
      if (
        key &&
        !BetterC0de_AGENT_KNOWN_KEYS.has(key) &&
        !BetterC0de_AGENT_KNOWN_KEYS.has(normalized)
      ) {
        optionKeys.add(key)
      }
      continue
    }

    if (!currentTop) continue
    const nested = /^(\s+)([^:#]+?)\s*:\s*(.*?)\s*$/.exec(line)
    if (!nested) continue
    const indent = nested[1]?.length ?? 0
    const key = (nested[2] ?? "").trim()
    const rawValue = stripYamlScalarQuotes(nested[3] ?? "")
    if (!key) continue

    if (currentTop === "tools") {
      const value = parseBooleanScalar(rawValue)
      if (typeof value === "boolean") tools[key] = value
      continue
    }

    if (currentTop === "options") {
      optionKeys.add(key)
      continue
    }

    if (currentTop === "permission") {
      if (indent <= 2) {
        currentPermission = null
        if (rawValue) {
          permission[key] = rawValue
        } else {
          currentPermission = key
          permission[key] = {}
        }
        continue
      }
      if (currentPermission) {
        const bucket = permission[currentPermission]
        if (bucket && typeof bucket === "object" && !Array.isArray(bucket)) {
          ;(bucket as Record<string, unknown>)[key] = rawValue
        }
      }
    }
  }

  return {
    ...scalar,
    tools,
    optionKeys: [...optionKeys].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    ),
    ...(Object.keys(permission).length > 0 ? { permission } : {}),
  }
}
