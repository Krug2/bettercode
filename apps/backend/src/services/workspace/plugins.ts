import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { isPathInside } from "./files"
import { readBoolean, readConfigValue, readUnknownRecord } from "./formatters"
import {
  betterC0deHomeDir,
  expandHomePath,
  formatBetterC0deConfigSourcePath,
  isBetterC0dePureMode,
  platformAbsolutePathKey,
  readBetterC0deProjectConfigs,
  uniqueAbsolutePaths,
} from "./project-config"
import { readPositiveInteger, readString } from "./providers"
import {
  betterC0deConfigSubdirSources,
  collectedFileSourcePath,
  workspaceRelativePath,
} from "./resources"

export interface ProjectPluginTemplate {
  id: string
  spec: string
  kind: "npm" | "file" | "url" | "invalid"
  sourcePath: string
  optionsKeys: string[]
  path?: string
  relativePath?: string
  exists?: boolean
  message?: string
  skipped?: boolean
  skippedReason?: string
  metaSourcePath?: string
  metaSource?: "file" | "npm"
  metaTarget?: string
  metaRequested?: string
  metaVersion?: string
  metaLoadCount?: number
  metaLastTime?: number
  metaTimeChanged?: number
  metaThemes?: string[]
}

export interface ProjectToolFlagTemplate {
  tool: string
  enabled: boolean
  sourcePath: string
  kind?: "flag" | "custom"
  exportName?: string
}

export async function listProjectPlugins(
  cwd: string
): Promise<ProjectPluginTemplate[]> {
  const root = path.resolve(cwd)
  const byId = new Map<string, ProjectPluginTemplate>()
  const pluginMeta = await readBetterC0dePluginMetaEntries()

  for (const {
    config,
    sourcePath,
    absoluteSourcePath,
  } of await readBetterC0deProjectConfigs(root)) {
    const plugins = readConfigValue(config, "plugin")
    if (!Array.isArray(plugins)) continue
    plugins.forEach((plugin, index) => {
      const parsed = projectPluginFromConfig(
        root,
        plugin,
        sourcePath,
        index,
        absoluteSourcePath
      )
      if (parsed) byId.set(parsed.id, parsed)
    })
  }

  for (const plugin of await discoverProjectPluginFiles(root)) {
    const duplicateFile = Array.from(byId.values()).some(
      (existing) =>
        existing.kind === "file" &&
        ((existing.relativePath &&
          plugin.relativePath &&
          existing.relativePath === plugin.relativePath) ||
          (existing.path &&
            plugin.path &&
            platformAbsolutePathKey(existing.path) ===
              platformAbsolutePathKey(plugin.path)))
    )
    if (duplicateFile) continue
    byId.set(plugin.id, plugin)
  }

  const plugins = Array.from(byId.values())
    .map((plugin) => attachProjectPluginMeta(plugin, pluginMeta))
    .map((plugin) =>
      isBetterC0dePureMode()
        ? {
            ...plugin,
            skipped: true,
            skippedReason: "Skipped by BetterC0de_PURE",
          }
        : plugin
    )

  return plugins.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
  )
}

export async function listProjectTools(
  cwd: string
): Promise<ProjectToolFlagTemplate[]> {
  const root = path.resolve(cwd)
  const byTool = new Map<string, ProjectToolFlagTemplate>()

  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root,
    { strict: true }
  )) {
    const rawTools = readConfigValue(config, "tools")
    if (rawTools === undefined) continue
    if (!rawTools || typeof rawTools !== "object" || Array.isArray(rawTools)) {
      throw Object.assign(
        new Error(`Invalid project tool policy: ${sourcePath}#tools`),
        { statusCode: 503 }
      )
    }
    const tools = rawTools as Record<string, unknown>
    for (const [tool, value] of Object.entries(tools)) {
      const enabled = readBoolean(value)
      if (typeof enabled !== "boolean") {
        throw Object.assign(
          new Error(
            `Invalid project tool policy: ${sourcePath}#tools.${tool} must be boolean.`
          ),
          { statusCode: 503 }
        )
      }
      byTool.set(tool, {
        tool,
        enabled,
        kind: "flag",
        sourcePath: `${sourcePath}#tools.${tool}`,
      })
    }
  }

  for (const tool of await discoverProjectCustomToolFiles(root)) {
    const key = byTool.has(tool.tool)
      ? `custom:${tool.tool}:${tool.sourcePath}:${tool.exportName ?? ""}`
      : tool.tool
    byTool.set(key, tool)
  }

  return Array.from(byTool.values()).sort((a, b) =>
    a.tool.localeCompare(b.tool, undefined, { sensitivity: "base" })
  )
}

function projectPluginFromConfig(
  workspaceRoot: string,
  rawPlugin: unknown,
  sourcePath: string,
  index: number,
  absoluteSourcePath?: string
): ProjectPluginTemplate | null {
  const parsed = normalizeBetterC0dePluginSpec(rawPlugin)
  if (!parsed) return null

  const base = {
    id: pluginDisplayId(parsed.spec),
    spec: parsed.spec,
    sourcePath: `${sourcePath}#plugin.${index}`,
    optionsKeys: Object.keys(parsed.options).sort(),
  }

  if (isUrlPluginSpec(parsed.spec)) {
    return { ...base, kind: "url" }
  }
  if (!isPathPluginSpec(parsed.spec)) {
    return { ...base, kind: "npm" }
  }

  const resolved = resolveBetterC0dePluginPath(
    workspaceRoot,
    parsed.spec,
    absoluteSourcePath
  )
  if (!resolved.ok) {
    return {
      ...base,
      kind: "invalid",
      message: resolved.message,
    }
  }

  return {
    ...base,
    kind: "file",
    path: resolved.path,
    exists: fsSync.existsSync(resolved.path),
    ...workspaceRelativePath(workspaceRoot, resolved.path),
  }
}

async function discoverProjectPluginFiles(
  workspaceRoot: string
): Promise<ProjectPluginTemplate[]> {
  const out: ProjectPluginTemplate[] = []
  for (const pluginRoot of betterC0deConfigSubdirSources(workspaceRoot, [
    "plugin",
    "plugins",
  ])) {
    const absoluteRoot = pluginRoot.absolutePath
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(absoluteRoot, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(?:j|t)s$/i.test(entry.name)) continue
      const absolutePath = path.join(absoluteRoot, entry.name)
      const sourcePath = collectedFileSourcePath(
        workspaceRoot,
        absoluteRoot,
        pluginRoot.sourcePath,
        absolutePath
      )
      out.push({
        id: sourcePath,
        spec: sourcePath,
        kind: "file",
        sourcePath,
        optionsKeys: [],
        path: absolutePath,
        exists: true,
        ...workspaceRelativePath(workspaceRoot, absolutePath),
      })
    }
  }
  return out
}

interface BetterC0dePluginMetaEntry {
  sourcePath: string
  source?: "file" | "npm"
  target?: string
  requested?: string
  version?: string
  loadCount?: number
  lastTime?: number
  timeChanged?: number
  themes?: string[]
}

async function readBetterC0dePluginMetaEntries(): Promise<
  Map<string, BetterC0dePluginMetaEntry>
> {
  for (const metaPath of betterC0dePluginMetaFileCandidates()) {
    try {
      const raw = await fs.readFile(metaPath, "utf8")
      const parsed = readUnknownRecord(JSON.parse(raw))
      const out = new Map<string, BetterC0dePluginMetaEntry>()
      for (const [id, rawEntry] of Object.entries(parsed)) {
        const entry = readUnknownRecord(rawEntry)
        const source = readString(entry.source)
        const themes = Object.keys(readUnknownRecord(entry.themes)).sort(
          (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })
        )
        out.set(id, {
          sourcePath: formatBetterC0deConfigSourcePath(metaPath),
          ...(source === "file" || source === "npm" ? { source } : {}),
          ...(readString(entry.target)
            ? { target: readString(entry.target) }
            : {}),
          ...(readString(entry.requested)
            ? { requested: readString(entry.requested) }
            : {}),
          ...(readString(entry.version)
            ? { version: readString(entry.version) }
            : {}),
          ...(readPositiveInteger(entry.load_count)
            ? { loadCount: readPositiveInteger(entry.load_count) }
            : {}),
          ...(readPositiveInteger(entry.last_time)
            ? { lastTime: readPositiveInteger(entry.last_time) }
            : {}),
          ...(readPositiveInteger(entry.time_changed)
            ? { timeChanged: readPositiveInteger(entry.time_changed) }
            : {}),
          ...(themes.length > 0 ? { themes } : {}),
        })
      }
      return out
    } catch {
      continue
    }
  }
  return new Map()
}

function attachProjectPluginMeta(
  plugin: ProjectPluginTemplate,
  meta: ReadonlyMap<string, BetterC0dePluginMetaEntry>
): ProjectPluginTemplate {
  const entry =
    meta.get(plugin.id) ||
    meta.get(plugin.spec) ||
    (plugin.path ? meta.get(plugin.path) : undefined) ||
    (plugin.relativePath ? meta.get(plugin.relativePath) : undefined)
  if (!entry) return plugin
  return {
    ...plugin,
    metaSourcePath: entry.sourcePath,
    metaSource: entry.source,
    metaTarget: entry.target,
    metaRequested: entry.requested,
    metaVersion: entry.version,
    metaLoadCount: entry.loadCount,
    metaLastTime: entry.lastTime,
    metaTimeChanged: entry.timeChanged,
    metaThemes: entry.themes,
  }
}

function betterC0dePluginMetaFileCandidates(): string[] {
  const override = process.env.BetterC0de_PLUGIN_META_FILE?.trim()
  if (override) return [path.resolve(expandHomePath(override))]
  return betterC0deStateDirectories().map((dir) =>
    path.join(dir, "plugin-meta.json")
  )
}

async function discoverProjectCustomToolFiles(
  workspaceRoot: string
): Promise<ProjectToolFlagTemplate[]> {
  const out: ProjectToolFlagTemplate[] = []
  for (const toolRoot of betterC0deConfigSubdirSources(workspaceRoot, [
    "tool",
    "tools",
  ])) {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(toolRoot.absolutePath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(?:j|t)s$/i.test(entry.name)) continue

      const absolutePath = path.join(toolRoot.absolutePath, entry.name)
      const namespace = path.basename(entry.name, path.extname(entry.name))
      const sourcePath = collectedFileSourcePath(
        workspaceRoot,
        toolRoot.absolutePath,
        toolRoot.sourcePath,
        absolutePath
      )
      const exportNames = await discoverBetterC0deToolExportNames(absolutePath)
      for (const exportName of exportNames) {
        out.push({
          tool:
            exportName === "default" ? namespace : `${namespace}_${exportName}`,
          enabled: true,
          kind: "custom",
          exportName,
          sourcePath,
        })
      }
    }
  }
  return out
}

async function discoverBetterC0deToolExportNames(
  absolutePath: string
): Promise<string[]> {
  let content: string
  try {
    content = await fs.readFile(absolutePath, "utf8")
  } catch {
    return []
  }

  const names = new Set<string>()
  if (/\bexport\s+default\b/.test(content)) names.add("default")

  const declaration =
    /\bexport\s+(?:const|let|var|function|async\s+function|class)\s+([A-Za-z_$][\w$]*)/g
  for (const match of content.matchAll(declaration)) {
    if (match[1]) names.add(match[1])
  }

  const namedExport = /\bexport\s*\{([^}]+)\}/g
  for (const match of content.matchAll(namedExport)) {
    const block = match[1]
    if (!block) continue
    for (const rawPart of block.split(",")) {
      const part = rawPart.trim()
      if (!part || part.startsWith("type ")) continue
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(part)
      const direct = /^([A-Za-z_$][\w$]*)$/.exec(part)
      const name = alias?.[1] ?? direct?.[1]
      if (name) names.add(name)
    }
  }

  return [...names]
}

function normalizeBetterC0dePluginSpec(
  rawPlugin: unknown
): { spec: string; options: Record<string, unknown> } | null {
  if (typeof rawPlugin === "string" && rawPlugin.trim()) {
    return { spec: rawPlugin.trim(), options: {} }
  }
  if (!Array.isArray(rawPlugin)) return null
  const spec = readString(rawPlugin[0])
  if (!spec) return null
  return {
    spec,
    options: readUnknownRecord(rawPlugin[1]),
  }
}

function isUrlPluginSpec(spec: string): boolean {
  return /^https?:\/\//i.test(spec)
}

function isPathPluginSpec(spec: string): boolean {
  return (
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("~/") ||
    spec.startsWith("file://")
  )
}

function resolveBetterC0dePluginPath(
  workspaceRoot: string,
  spec: string,
  absoluteSourcePath?: string
): { ok: true; path: string } | { ok: false; message: string } {
  const sourceDir = absoluteSourcePath
    ? path.dirname(absoluteSourcePath)
    : workspaceRoot
  const sourceIsInsideWorkspace = absoluteSourcePath
    ? isPathInside(workspaceRoot, absoluteSourcePath)
    : true
  if (spec.startsWith("file://")) {
    try {
      const url = new URL(spec)
      return constrainPluginPath(
        workspaceRoot,
        decodeURIComponent(url.pathname),
        sourceIsInsideWorkspace
      )
    } catch {
      return { ok: false, message: "Invalid file URL plugin spec" }
    }
  }
  if (spec.startsWith("~/")) {
    return constrainPluginPath(
      workspaceRoot,
      path.resolve(betterC0deHomeDir(), spec.slice(2)),
      sourceIsInsideWorkspace
    )
  }
  return constrainPluginPath(
    workspaceRoot,
    path.isAbsolute(spec) ? path.resolve(spec) : path.resolve(sourceDir, spec),
    sourceIsInsideWorkspace
  )
}

function constrainPluginPath(
  workspaceRoot: string,
  resolvedPath: string,
  sourceIsInsideWorkspace: boolean
): { ok: true; path: string } | { ok: false; message: string } {
  if (sourceIsInsideWorkspace && !isPathInside(workspaceRoot, resolvedPath)) {
    return {
      ok: false,
      message:
        "Local plugin paths must stay inside the active workspace in BetterC0de",
    }
  }
  return { ok: true, path: resolvedPath }
}

function pluginDisplayId(spec: string): string {
  if (spec.startsWith("file://")) return spec.slice("file://".length)
  return spec
}

function betterC0deStateDirectories(): string[] {
  const xdgState = process.env.XDG_STATE_HOME?.trim()
  const stateRoot = xdgState
    ? path.resolve(expandHomePath(xdgState))
    : path.join(betterC0deHomeDir(), ".local", "state")
  return uniqueAbsolutePaths([
    path.join(stateRoot, "betterc0de"),
    path.join(stateRoot, "BetterC0de"),
  ])
}
