import dns from "node:dns/promises"
import fs from "node:fs/promises"
import https from "node:https"
import net from "node:net"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import { compileBoundedGlob } from "../bounded-glob"
import { isPathInside, safeResolveInside } from "./files"
import { PROJECT_COMMAND_MAX_BYTES, readUnknownRecord } from "./formatters"
import {
  betterC0deConfigDirectorySources,
  betterC0deGlobalConfigDirectories,
  betterC0deHomeDir,
  formatBetterC0deConfigSourcePath,
  formatBetterC0deDirectoryFileSourcePath,
  isBetterC0deClaudeCodePromptDisabled,
  isBetterC0deClaudeCodeSkillsDisabled,
  isBetterC0deProjectConfigDisabled,
  parseBooleanScalar,
  parseNumberScalar,
  parsePositiveIntegerScalar,
  platformAbsolutePathKey,
  platformCanonicalAbsolutePath,
  readBetterC0deProjectConfigs,
  readBoundedUtf8File,
  readRecord,
  uniqueAbsolutePaths,
  type BoundedUtf8File,
} from "./project-config"
import { readString } from "./providers"
import {
  PROJECT_CACHE_MAX_ENTRIES,
  readStringArray,
  setBoundedCache,
} from "./search"

function truncateUtf8String(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  const buffer = Buffer.from(value, "utf8")
  if (buffer.byteLength <= maxBytes) return value
  const decoder = new StringDecoder("utf8")
  return decoder.write(buffer.subarray(0, maxBytes))
}

export interface ProjectSkillTemplate {
  id: string
  name: string
  description?: string
  sourcePath: string
  sourceUrl?: string
  content: string
}

export interface ProjectInstructionTemplate {
  sourcePath: string
  content: string
}

export const PROJECT_COMMAND_MAX_DEPTH = 8

export const PROJECT_COMMAND_MAX_FILES = 200

const PROJECT_INSTRUCTION_MAX_FILES = 64

const PROJECT_INSTRUCTION_MAX_TOTAL_BYTES = 2 * 1024 * 1024

const REMOTE_PROJECT_SKILL_CACHE_TTL_MS = 5 * 60 * 1000

const REMOTE_PROJECT_MAX_SOURCES = 8

const REMOTE_PROJECT_SINGLE_FLIGHT_MAX_ENTRIES = 32

const REMOTE_PROJECT_MAX_SKILLS = 16

const REMOTE_PROJECT_SKILL_FETCH_CONCURRENCY = 8

const REMOTE_PROJECT_FETCH_TIMEOUT_MS = 5_000

const REMOTE_PROJECT_FETCH_MAX_REDIRECTS = 3

type RemoteProjectAddress = {
  address: string
  family: number
}

type RemoteProjectFetchDependencies = {
  lookup: (hostname: string) => Promise<RemoteProjectAddress[]>
  request: (
    url: URL,
    address: RemoteProjectAddress,
    signal: AbortSignal
  ) => Promise<Response>
}

const BetterC0de_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"]

const BetterC0de_BUILTIN_CUSTOMIZE_SKILL: ProjectSkillTemplate = {
  id: "customize-betterc0de",
  name: "customize-betterc0de",
  description:
    "Guidance for safely customizing BetterC0de compatibility config, agents, skills, plugins, MCP, providers, and terminal UI settings.",
  sourcePath: "<built-in>",
  content: [
    "# Customizing BetterC0de",
    "",
    "BetterC0de reads compatibility config strictly and may ignore or reject fields with the wrong shape. Prefer the built-in Settings > Compatibility views before writing unfamiliar keys.",
    "",
    "Common locations:",
    "- Project config: `betterc0de.json`, `betterc0de.jsonc`, or `.betterc0de/betterc0de.json`.",
    "- Global config: `~/.config/betterc0de/betterc0de.json`.",
    "- Project agents: `.betterc0de/agent/<name>.md` or `.betterc0de/agents/<name>.md`.",
    "- Project skills: `.betterc0de/skill/<name>/SKILL.md` or `.betterc0de/skills/<name>/SKILL.md`.",
    "- TUI config: `tui.json`, `tui.jsonc`, or `.betterc0de/tui.json`.",
    "",
    "After editing compatibility config-time files, refresh BetterC0de or restart the active provider so the runtime reloads the new configuration.",
  ].join("\n"),
}

type BetterC0deInstructionMatch = {
  sourcePath: string
  absolutePath: string
}

const remoteProjectSkillCache = new Map<
  string,
  { checkedAt: number; value: ProjectSkillTemplate[] }
>()

const remoteProjectInstructionCache = new Map<
  string,
  { checkedAt: number; value: ProjectInstructionTemplate | null }
>()

const remoteProjectSkillInFlight = new Map<
  string,
  Promise<ProjectSkillTemplate[]>
>()

const remoteProjectInstructionInFlight = new Map<
  string,
  Promise<ProjectInstructionTemplate | null>
>()

const defaultRemoteProjectFetchDependencies: RemoteProjectFetchDependencies = {
  lookup: async (hostname) =>
    (await dns.lookup(hostname, { all: true, verbatim: true })).map(
      (entry) => ({
        address: entry.address,
        family: entry.family,
      })
    ),
  request: requestPinnedRemoteProjectUrl,
}

let remoteProjectFetchDependencies = defaultRemoteProjectFetchDependencies

export function __setRemoteProjectFetchDependenciesForTests(
  dependencies: Partial<RemoteProjectFetchDependencies> | null
): void {
  remoteProjectFetchDependencies = dependencies
    ? { ...defaultRemoteProjectFetchDependencies, ...dependencies }
    : defaultRemoteProjectFetchDependencies
  remoteProjectSkillCache.clear()
  remoteProjectInstructionCache.clear()
  remoteProjectSkillInFlight.clear()
  remoteProjectInstructionInFlight.clear()
}

function runBoundedSingleFlight<K, V>(
  inFlight: Map<K, Promise<V>>,
  key: K,
  operation: () => Promise<V>,
  maxEntries: number,
  saturatedValue: V
): Promise<V> {
  const existing = inFlight.get(key)
  if (existing) return existing

  if (inFlight.size >= maxEntries) {
    return Promise.resolve(saturatedValue)
  }

  const pending = Promise.resolve().then(operation)
  inFlight.set(key, pending)
  void pending
    .finally(() => {
      if (inFlight.get(key) === pending) {
        inFlight.delete(key)
      }
    })
    .catch(() => {
      // Preserve the original promise's rejection for its callers; this catch
      // only prevents the detached cleanup chain from becoming unhandled.
    })
  return pending
}

export async function listProjectSkills(
  cwd: string
): Promise<ProjectSkillTemplate[]> {
  const root = path.resolve(cwd)
  const byId = new Map<string, ProjectSkillTemplate>([
    [BetterC0de_BUILTIN_CUSTOMIZE_SKILL.id, BetterC0de_BUILTIN_CUSTOMIZE_SKILL],
  ])

  for (const skillRoot of betterC0deConfigSubdirSources(root, [
    "skill",
    "skills",
  ])) {
    await collectProjectSkills(
      root,
      skillRoot.absolutePath,
      skillRoot.sourcePath,
      byId
    )
  }

  const workspaceSkillRoots = [
    ...(isBetterC0deProjectConfigDisabled()
      ? []
      : [
          ".betterc0de/skill",
          ".betterc0de/skills",
          ".BetterC0de/skill",
          ".BetterC0de/skills",
        ]),
    ...betterC0deExternalProjectSkillRoots(),
  ]

  for (const skillRoot of workspaceSkillRoots) {
    const absoluteRoot = safeResolveInside(root, skillRoot)
    await collectProjectSkills(root, absoluteRoot, skillRoot, byId)
  }

  for (const configuredRoot of await listBetterC0deConfiguredSkillRoots(root)) {
    let absoluteRoot: string
    try {
      absoluteRoot = safeResolveInside(root, configuredRoot)
    } catch {
      continue
    }
    await collectProjectSkills(root, absoluteRoot, configuredRoot, byId)
  }

  const remoteSkillUrls = (await listBetterC0deConfiguredSkillUrls(root)).slice(
    0,
    REMOTE_PROJECT_MAX_SOURCES
  )
  const remoteSkillGroups =
    remoteSkillUrls.length === 0
      ? []
      : await withRemoteProjectFetchDeadline(async (signal) =>
          Promise.all(
            remoteSkillUrls.map((sourceUrl) =>
              abortable(
                loadRemoteProjectSkills(sourceUrl, signal),
                signal
              ).catch(() => [] as ProjectSkillTemplate[])
            )
          )
        )
  for (const skills of remoteSkillGroups) {
    for (const skill of skills) {
      byId.set(skill.id, skill)
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
  )
}

export async function listProjectInstructions(
  cwd: string
): Promise<ProjectInstructionTemplate[]> {
  const root = path.resolve(cwd)
  const instructions = new Map<string, ProjectInstructionTemplate>()
  const remoteInstructionUrls: string[] = []
  const seenRemoteInstructionUrls = new Set<string>()
  await collectBetterC0deDefaultInstructions(root, instructions)
  for (const { config } of await readBetterC0deProjectConfigs(root)) {
    for (const rawInstruction of extractBetterC0deInstructionPaths(config)) {
      if (instructions.size >= PROJECT_INSTRUCTION_MAX_FILES) break
      const matches = await resolveProjectInstructionMatches(
        root,
        rawInstruction
      )
      for (const match of matches) {
        if (instructions.size >= PROJECT_INSTRUCTION_MAX_FILES) break
        await addProjectInstructionFile(root, instructions, match)
      }
    }
    for (const url of extractBetterC0deInstructionUrls(config)) {
      if (
        instructions.has(url) ||
        seenRemoteInstructionUrls.has(url) ||
        remoteInstructionUrls.length >= REMOTE_PROJECT_MAX_SOURCES
      ) {
        continue
      }
      seenRemoteInstructionUrls.add(url)
      remoteInstructionUrls.push(url)
    }
  }
  const remoteInstructions =
    remoteInstructionUrls.length === 0
      ? []
      : await withRemoteProjectFetchDeadline(async (signal) =>
          Promise.all(
            remoteInstructionUrls.map((sourceUrl) =>
              abortable(
                loadRemoteProjectInstruction(sourceUrl, signal),
                signal
              ).catch(() => null)
            )
          )
        )
  for (const instruction of remoteInstructions) {
    if (instruction) {
      setProjectInstructionWithinBudget(
        instructions,
        instruction.sourcePath,
        instruction
      )
    }
  }
  return Array.from(instructions.values()).sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath, undefined, {
      sensitivity: "base",
    })
  )
}

async function listBetterC0deConfiguredSkillRoots(
  workspaceRoot: string
): Promise<string[]> {
  const roots: string[] = []
  const seen = new Set<string>()
  for (const { config: parsed } of await readBetterC0deProjectConfigs(
    workspaceRoot
  )) {
    const skillPaths = extractBetterC0deSkillPaths(parsed)
    for (const rawPath of skillPaths) {
      const normalized = normalizeProjectSkillRoot(rawPath)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      roots.push(normalized)
    }
  }
  return roots
}

async function listBetterC0deConfiguredSkillUrls(
  workspaceRoot: string
): Promise<string[]> {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const { config: parsed } of await readBetterC0deProjectConfigs(
    workspaceRoot
  )) {
    const skillUrls = extractBetterC0deSkillUrls(parsed)
    for (const rawUrl of skillUrls) {
      const normalized = normalizeProjectSkillUrl(rawUrl)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(normalized)
    }
  }
  return urls
}

export function workspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string
): { relativePath?: string } {
  if (!isPathInside(workspaceRoot, absolutePath)) return {}
  const relative = path
    .relative(workspaceRoot, absolutePath)
    .replace(/\\/g, "/")
  return {
    relativePath: relative || ".",
  }
}

export function betterC0deConfigSubdirSources(
  workspaceRoot: string,
  dirNames: readonly string[]
): Array<{ sourcePath: string; absolutePath: string }> {
  const out: Array<{ sourcePath: string; absolutePath: string }> = []
  const seen = new Set<string>()
  for (const source of betterC0deConfigDirectorySources(workspaceRoot)) {
    for (const dirName of dirNames) {
      const absolutePath = platformCanonicalAbsolutePath(
        path.join(source.absolutePath, dirName)
      )
      const key = platformAbsolutePathKey(absolutePath)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        absolutePath,
        sourcePath: formatBetterC0deDirectoryFileSourcePath(
          workspaceRoot,
          absolutePath
        ),
      })
    }
  }
  return out
}

function betterC0deExternalProjectSkillRoots(): string[] {
  if (
    parseBooleanScalar(process.env.BetterC0de_DISABLE_EXTERNAL_SKILLS ?? "") ===
    true
  ) {
    return []
  }
  return [
    ".agents/skills",
    ...(isBetterC0deClaudeCodeSkillsDisabled() ? [] : [".claude/skills"]),
  ]
}

function betterC0deInstructionFiles(): string[] {
  const disableClaude = isBetterC0deClaudeCodePromptDisabled()
  return BetterC0de_INSTRUCTION_FILES.filter(
    (fileName) => fileName !== "CLAUDE.md" || !disableClaude
  )
}

async function collectBetterC0deDefaultInstructions(
  workspaceRoot: string,
  out: Map<string, ProjectInstructionTemplate>
): Promise<void> {
  const globalCandidates = uniqueAbsolutePaths([
    ...betterC0deGlobalConfigDirectories().map((dir) =>
      path.join(dir, "AGENTS.md")
    ),
    ...(isBetterC0deClaudeCodePromptDisabled()
      ? []
      : [path.join(betterC0deHomeDir(), ".claude", "CLAUDE.md")]),
  ])
  for (const candidate of globalCandidates) {
    if (
      await addProjectInstructionFile(workspaceRoot, out, {
        absolutePath: candidate,
        sourcePath: formatInstructionSourcePath(workspaceRoot, candidate),
      })
    ) {
      break
    }
  }
  if (isBetterC0deProjectConfigDisabled()) return

  for (const fileName of betterC0deInstructionFiles()) {
    const matches = await findInstructionFilesUp(workspaceRoot, fileName)
    if (matches.length === 0) continue
    for (const match of matches) {
      await addProjectInstructionFile(workspaceRoot, out, match)
    }
    break
  }
}

async function addProjectInstructionFile(
  workspaceRoot: string,
  out: Map<string, ProjectInstructionTemplate>,
  match: BetterC0deInstructionMatch
): Promise<boolean> {
  const key = path.resolve(match.absolutePath)
  if (out.has(key) || out.size >= PROJECT_INSTRUCTION_MAX_FILES) return false
  let read: BoundedUtf8File
  try {
    read = await readBoundedUtf8File(
      match.absolutePath,
      PROJECT_COMMAND_MAX_BYTES,
      { truncate: true }
    )
  } catch {
    return false
  }
  const trimmed = read.text.trim()
  if (!trimmed) return false
  const content = read.truncated ? `${trimmed}\n\n...[truncated]` : trimmed
  return setProjectInstructionWithinBudget(out, key, {
    sourcePath: match.sourcePath,
    content,
  })
}

function setProjectInstructionWithinBudget(
  out: Map<string, ProjectInstructionTemplate>,
  key: string,
  instruction: ProjectInstructionTemplate
): boolean {
  if (out.has(key) || out.size >= PROJECT_INSTRUCTION_MAX_FILES) return false
  const usedBytes = Array.from(out.values()).reduce(
    (total, entry) => total + Buffer.byteLength(entry.content, "utf8"),
    0
  )
  const remaining = PROJECT_INSTRUCTION_MAX_TOTAL_BYTES - usedBytes
  if (remaining <= 0) return false

  let content = instruction.content
  if (Buffer.byteLength(content, "utf8") > remaining) {
    const marker = "\n\n...[aggregate truncated]"
    const markerBytes = Buffer.byteLength(marker, "utf8")
    if (remaining <= markerBytes) return false
    content = `${truncateUtf8String(
      content,
      remaining - markerBytes
    ).trimEnd()}${marker}`
  }
  if (!content.trim()) return false
  out.set(key, { ...instruction, content })
  return true
}

async function findInstructionFilesUp(
  workspaceRoot: string,
  fileName: string
): Promise<BetterC0deInstructionMatch[]> {
  const matches: BetterC0deInstructionMatch[] = []
  let current = path.resolve(workspaceRoot)
  while (true) {
    const absolutePath = path.join(current, fileName)
    try {
      const stat = await fs.stat(absolutePath)
      if (stat.isFile()) {
        matches.push({
          absolutePath,
          sourcePath: formatInstructionSourcePath(workspaceRoot, absolutePath),
        })
      }
    } catch {
      // Missing instruction files are expected while walking upward.
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return matches
}

function formatInstructionSourcePath(
  workspaceRoot: string,
  absolutePath: string
): string {
  const relative = workspaceRelativePath(workspaceRoot, absolutePath)
  return relative.relativePath ?? formatBetterC0deConfigSourcePath(absolutePath)
}

function extractBetterC0deSkillPaths(config: unknown): string[] {
  const skills = readRecord(config, "skills")
  const paths = skills.paths
  if (!Array.isArray(paths)) return []
  return paths.filter((item): item is string => typeof item === "string")
}

function extractBetterC0deSkillUrls(config: unknown): string[] {
  const skills = readRecord(config, "skills")
  const urls = skills.urls
  if (!Array.isArray(urls)) return []
  return urls.filter((item): item is string => typeof item === "string")
}

function extractBetterC0deInstructionPaths(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return []
  const instructions = (config as Record<string, unknown>).instructions
  if (!Array.isArray(instructions)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of instructions) {
    if (typeof item !== "string") continue
    const normalized = normalizeProjectInstructionPattern(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function extractBetterC0deInstructionUrls(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return []
  const instructions = (config as Record<string, unknown>).instructions
  if (!Array.isArray(instructions)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of instructions) {
    if (typeof item !== "string") continue
    const trimmed = item.trim()
    const parsed = parseRemoteProjectUrl(trimmed)
    if (!parsed) continue
    const normalized = parsed.href
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizeProjectInstructionPattern(value: string): string | null {
  const trimmed = value.trim()
  if (
    !trimmed ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return null
  }
  if (trimmed.startsWith("~/") || path.isAbsolute(trimmed)) return trimmed
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
  if (!normalized || normalized.split("/").includes("..")) return null
  return normalized
}

async function resolveProjectInstructionMatches(
  workspaceRoot: string,
  pattern: string
): Promise<BetterC0deInstructionMatch[]> {
  if (pattern.startsWith("~/") || path.isAbsolute(pattern)) {
    return resolveAbsoluteInstructionMatches(workspaceRoot, pattern)
  }

  if (!hasGlobMeta(pattern)) {
    return findRelativeInstructionFilesUp(workspaceRoot, pattern)
  }

  const matchesPath = compileBoundedGlob(pattern, { optionalGlobstarDirectory: false })
  const matches: BetterC0deInstructionMatch[] = []
  let scanned = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (
      depth > PROJECT_COMMAND_MAX_DEPTH ||
      scanned >= PROJECT_COMMAND_MAX_FILES
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
      if (scanned >= PROJECT_COMMAND_MAX_FILES) return
      if (shouldSkipInstructionDir(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      scanned += 1
      const relative = path.relative(workspaceRoot, abs).replace(/\\/g, "/")
      if (matchesPath(relative)) {
        matches.push({
          absolutePath: abs,
          sourcePath: relative,
        })
      }
    }
  }

  await walk(workspaceRoot, 0)
  return matches
}

async function resolveAbsoluteInstructionMatches(
  workspaceRoot: string,
  pattern: string
): Promise<BetterC0deInstructionMatch[]> {
  const absolutePattern = pattern.startsWith("~/")
    ? path.join(betterC0deHomeDir(), pattern.slice(2))
    : path.resolve(pattern)
  const directory = path.dirname(absolutePattern)
  const filePattern = path.basename(absolutePattern)
  if (!hasGlobMeta(filePattern)) {
    try {
      const stat = await fs.stat(absolutePattern)
      return stat.isFile()
        ? [
            {
              absolutePath: absolutePattern,
              sourcePath: formatInstructionSourcePath(
                workspaceRoot,
                absolutePattern
              ),
            },
          ]
        : []
    } catch {
      return []
    }
  }

  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const matchesPath = compileBoundedGlob(filePattern, { optionalGlobstarDirectory: false })
  return entries
    .filter((entry) => entry.isFile() && matchesPath(entry.name))
    .slice(0, PROJECT_COMMAND_MAX_FILES)
    .map((entry) => {
      const absolutePath = path.join(directory, entry.name)
      return {
        absolutePath,
        sourcePath: formatInstructionSourcePath(workspaceRoot, absolutePath),
      }
    })
}

async function findRelativeInstructionFilesUp(
  workspaceRoot: string,
  relativePattern: string
): Promise<BetterC0deInstructionMatch[]> {
  const matches: BetterC0deInstructionMatch[] = []
  let current = path.resolve(workspaceRoot)
  while (true) {
    const absolutePath = path.join(current, relativePattern)
    try {
      const stat = await fs.stat(absolutePath)
      if (stat.isFile()) {
        matches.push({
          absolutePath,
          sourcePath: formatInstructionSourcePath(workspaceRoot, absolutePath),
        })
      }
    } catch {
      // Missing config instruction files are expected while walking upward.
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return matches
}

function hasGlobMeta(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern)
}

function shouldSkipInstructionDir(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
  ].includes(name)
}

function normalizeProjectSkillRoot(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith("~/") || path.isAbsolute(trimmed)) {
    return null
  }
  return trimmed
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
}

function normalizeProjectSkillUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const url = parseRemoteProjectUrl(trimmed)
  if (!url) return null
  return url.href.endsWith("/") ? url.href : `${url.href}/`
}

async function collectProjectSkills(
  workspaceRoot: string,
  skillRoot: string,
  skillRootRelative: string,
  out: Map<string, ProjectSkillTemplate>
): Promise<void> {
  try {
    const stat = await fs.stat(skillRoot)
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
      if (entry.name !== "SKILL.md" || !entry.isFile()) continue

      let stat: import("node:fs").Stats
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size > PROJECT_COMMAND_MAX_BYTES) continue

      seen += 1
      let content: string
      try {
        content = await fs.readFile(abs, "utf8")
      } catch {
        continue
      }
      const parsed = parseProjectSkillMarkdown(content)
      if (!parsed.name) continue

      out.set(parsed.name, {
        id: parsed.name,
        name: parsed.name,
        sourcePath: collectedFileSourcePath(
          workspaceRoot,
          skillRoot,
          skillRootRelative,
          abs
        ),
        content: parsed.content,
        ...(parsed.description ? { description: parsed.description } : {}),
      })
    }
  }

  await walk(skillRoot, 0)
}

export function collectedFileSourcePath(
  workspaceRoot: string,
  sourceRoot: string,
  sourceRootLabel: string,
  absoluteFile: string
): string {
  const relativeToWorkspace = path
    .relative(path.resolve(workspaceRoot), absoluteFile)
    .replace(/\\/g, "/")
  if (
    relativeToWorkspace &&
    !relativeToWorkspace.startsWith("..") &&
    !path.isAbsolute(relativeToWorkspace)
  ) {
    return relativeToWorkspace
  }
  const relativeToSourceRoot = path
    .relative(sourceRoot, absoluteFile)
    .replace(/\\/g, "/")
  return `${sourceRootLabel.replace(/\/+$/, "")}/${relativeToSourceRoot}`
}

async function loadRemoteProjectSkills(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<ProjectSkillTemplate[]> {
  const cached = remoteProjectSkillCache.get(sourceUrl)
  const now = Date.now()
  if (cached && now - cached.checkedAt < REMOTE_PROJECT_SKILL_CACHE_TTL_MS) {
    remoteProjectSkillCache.delete(sourceUrl)
    remoteProjectSkillCache.set(sourceUrl, cached)
    return cached.value
  }
  if (cached) remoteProjectSkillCache.delete(sourceUrl)

  return await runBoundedSingleFlight(
    remoteProjectSkillInFlight,
    sourceUrl,
    async () => {
      const skills = await fetchRemoteProjectSkills(sourceUrl, signal).catch(
        () => []
      )
      setBoundedCache(
        remoteProjectSkillCache,
        sourceUrl,
        { checkedAt: now, value: skills },
        PROJECT_CACHE_MAX_ENTRIES
      )
      return skills
    },
    REMOTE_PROJECT_SINGLE_FLIGHT_MAX_ENTRIES,
    []
  )
}

async function loadRemoteProjectInstruction(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<ProjectInstructionTemplate | null> {
  const cached = remoteProjectInstructionCache.get(sourceUrl)
  const now = Date.now()
  if (cached && now - cached.checkedAt < REMOTE_PROJECT_SKILL_CACHE_TTL_MS) {
    remoteProjectInstructionCache.delete(sourceUrl)
    remoteProjectInstructionCache.set(sourceUrl, cached)
    return cached.value
  }
  if (cached) remoteProjectInstructionCache.delete(sourceUrl)

  return await runBoundedSingleFlight(
    remoteProjectInstructionInFlight,
    sourceUrl,
    async () => {
      const content = await fetchRemoteText(sourceUrl, signal)
      const value =
        content && content.trim()
          ? { sourcePath: sourceUrl, content: content.trim() }
          : null
      setBoundedCache(
        remoteProjectInstructionCache,
        sourceUrl,
        { checkedAt: now, value },
        PROJECT_CACHE_MAX_ENTRIES
      )
      return value
    },
    REMOTE_PROJECT_SINGLE_FLIGHT_MAX_ENTRIES,
    null
  )
}

async function fetchRemoteProjectSkills(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<ProjectSkillTemplate[]> {
  const baseUrl = normalizeProjectSkillUrl(sourceUrl)
  if (!baseUrl) return []

  if (!signal) {
    return await withRemoteProjectFetchDeadline((deadlineSignal) =>
      fetchRemoteProjectSkills(sourceUrl, deadlineSignal)
    )
  }

  const indexJson = await fetchRemoteJson(
    new URL("index.json", baseUrl).href,
    signal
  )
  const indexRecord = readUnknownRecord(indexJson)
  const remoteSkills = Array.isArray(indexRecord.skills)
    ? indexRecord.skills
    : []
  const loadSkill = async (
    rawSkill: unknown
  ): Promise<ProjectSkillTemplate | null> => {
    const skill = readUnknownRecord(rawSkill)
    const remoteName = readString(skill.name)
    const files = readStringArray(skill.files)
    if (!remoteName || !files.includes("SKILL.md")) return null
    if (!isSafeRemoteSkillName(remoteName)) return null

    const skillUrl = new URL(
      `${remoteName
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}/SKILL.md`,
      baseUrl
    ).href
    const content = await fetchRemoteText(skillUrl, signal)
    if (!content) return null

    const parsed = parseProjectSkillMarkdown(content)
    const skillId = parsed.name || remoteName
    if (!skillId) return null

    return {
      id: skillId,
      name: skillId,
      sourcePath: skillUrl,
      sourceUrl: baseUrl,
      content: parsed.content,
      ...(parsed.description ? { description: parsed.description } : {}),
    }
  }

  const out: ProjectSkillTemplate[] = []
  const boundedSkills = remoteSkills.slice(0, REMOTE_PROJECT_MAX_SKILLS)
  for (
    let index = 0;
    index < boundedSkills.length && !signal.aborted;
    index += REMOTE_PROJECT_SKILL_FETCH_CONCURRENCY
  ) {
    const loaded = await Promise.all(
      boundedSkills
        .slice(index, index + REMOTE_PROJECT_SKILL_FETCH_CONCURRENCY)
        .map(loadSkill)
    )
    for (const skill of loaded) {
      if (skill) out.push(skill)
    }
  }

  return out
}

async function fetchRemoteJson(
  url: string,
  signal: AbortSignal
): Promise<unknown | null> {
  const text = await fetchRemoteText(url, signal)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isPublicRemoteProjectAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().split("%", 1)[0] ?? ""
  if (net.isIPv4(normalized)) {
    const [a, b, c] = normalized.split(".").map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && c === 0) return false
    if (a === 192 && b === 0 && c === 2) return false
    if (a === 192 && b === 88 && c === 99) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if (a === 198 && b === 51 && c === 100) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (!net.isIPv6(normalized)) return false
  if (normalized === "::" || normalized === "::1") return false
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length)
    return net.isIPv4(mapped) && isPublicRemoteProjectAddress(mapped)
  }
  if (/^(?:fc|fd)/.test(normalized)) return false
  if (/^fe[89ab]/.test(normalized)) return false
  if (/^fe[c-f]/.test(normalized)) return false
  if (normalized.startsWith("ff")) return false
  if (normalized.startsWith("2001:db8:")) return false
  return true
}

function parseRemoteProjectUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl)
    if (
      parsed.protocol !== "https:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.hostname.length === 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) throw new Error("remote project fetch aborted")
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("remote project fetch aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

async function resolvePublicRemoteProjectAddress(
  hostname: string,
  signal: AbortSignal
): Promise<RemoteProjectAddress> {
  const addresses = await abortable(
    remoteProjectFetchDependencies.lookup(hostname),
    signal
  )
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicRemoteProjectAddress(entry.address))
  ) {
    throw new Error(
      `remote project URL resolved to a non-public address: ${hostname}`
    )
  }
  return addresses[0]!
}

function requestPinnedRemoteProjectUrl(
  url: URL,
  address: RemoteProjectAddress,
  signal: AbortSignal
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let settled = false
    const finishReject = (error: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      reject(error)
    }
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/markdown, text/plain;q=0.9",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family === 6 ? 6 : 4)
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.byteLength
          if (bytes > PROJECT_COMMAND_MAX_BYTES) {
            response.destroy(new Error("remote project response is too large"))
            return
          }
          chunks.push(buffer)
        })
        response.on("error", finishReject)
        response.on("end", () => {
          if (settled) return
          try {
            const headers = new Headers()
            for (const [key, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) {
                for (const item of value) headers.append(key, item)
              } else if (value !== undefined) {
                headers.set(key, String(value))
              }
            }
            const status = response.statusCode ?? 502
            const result = new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers }
            )
            settled = true
            signal.removeEventListener("abort", onAbort)
            resolve(result)
          } catch (error) {
            finishReject(error instanceof Error ? error : new Error(String(error)))
          }
        })
      }
    )
    const onAbort = () =>
      request.destroy(new Error("remote project fetch aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
    request.on("error", finishReject)
    request.end()
  })
}

async function withRemoteProjectFetchDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    REMOTE_PROJECT_FETCH_TIMEOUT_MS
  )
  try {
    return await operation(controller.signal)
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

async function fetchRemoteText(
  url: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (!signal) {
    return await withRemoteProjectFetchDeadline((deadlineSignal) =>
      fetchRemoteText(url, deadlineSignal)
    )
  }

  try {
    let current = parseRemoteProjectUrl(url)
    if (!current) return null

    for (
      let redirects = 0;
      redirects <= REMOTE_PROJECT_FETCH_MAX_REDIRECTS;
      redirects += 1
    ) {
      const address = await resolvePublicRemoteProjectAddress(
        current.hostname,
        signal
      )
      const response = await abortable(
        remoteProjectFetchDependencies.request(current, address, signal),
        signal
      )
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === REMOTE_PROJECT_FETCH_MAX_REDIRECTS) return null
        const location = response.headers.get("location")
        if (!location) return null
        current = parseRemoteProjectUrl(new URL(location, current).href)
        if (!current) return null
        continue
      }
      if (!response.ok) return null
      const contentLength = Number(response.headers.get("content-length") ?? 0)
      if (
        Number.isFinite(contentLength) &&
        contentLength > PROJECT_COMMAND_MAX_BYTES
      ) {
        return null
      }
      const body = Buffer.from(await abortable(response.arrayBuffer(), signal))
      if (body.byteLength > PROJECT_COMMAND_MAX_BYTES) return null
      return body.toString("utf8")
    }
    return null
  } catch {
    return null
  }
}

function isSafeRemoteSkillName(value: string): boolean {
  const parts = value.split("/")
  return parts.every((part) => part && part !== "." && part !== "..")
}

function parseProjectSkillMarkdown(content: string): {
  name?: string
  description?: string
  content: string
} {
  const normalized = content.replace(/^\uFEFF/, "")
  if (!normalized.startsWith("---")) {
    return { content: normalized.trim() }
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized)
  if (!match) return { content: normalized.trim() }

  const frontmatter = parseSimpleFrontmatter(match[1] ?? "")
  return {
    content: (match[2] ?? "").trim(),
    ...(frontmatter.name ? { name: frontmatter.name } : {}),
    ...(frontmatter.description
      ? { description: frontmatter.description }
      : {}),
  }
}

export function parseSimpleFrontmatter(input: string): {
  name?: string
  description?: string
  agent?: string
  color?: string
  disable?: boolean
  hidden?: boolean
  mode?: string
  model?: string
  variant?: string
  temperature?: number
  topP?: number
  steps?: number
  subtask?: boolean
} {
  const out: {
    name?: string
    description?: string
    agent?: string
    color?: string
    disable?: boolean
    hidden?: boolean
    mode?: string
    model?: string
    variant?: string
    temperature?: number
    topP?: number
    steps?: number
    subtask?: boolean
  } = {}
  for (const line of input.split(/\r?\n/g)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    const key = match[1]?.toLowerCase()
    const rawValue = stripYamlScalarQuotes(match[2] ?? "")
    if (key === "name" && rawValue) out.name = rawValue
    if (key === "description" && rawValue) out.description = rawValue
    if (key === "agent" && rawValue) out.agent = rawValue
    if (key === "color" && rawValue) out.color = rawValue
    if (key === "disable") out.disable = parseBooleanScalar(rawValue)
    if (key === "hidden") out.hidden = parseBooleanScalar(rawValue)
    if (key === "mode" && rawValue) out.mode = rawValue
    if (key === "model" && rawValue) out.model = rawValue
    if (key === "variant" && rawValue) out.variant = rawValue
    if (key === "temperature") out.temperature = parseNumberScalar(rawValue)
    if (key === "top_p") out.topP = parseNumberScalar(rawValue)
    if (key === "steps" || key === "maxsteps") {
      out.steps = parsePositiveIntegerScalar(rawValue)
    }
    if (key === "subtask") out.subtask = parseBooleanScalar(rawValue)
  }
  return out
}

export function stripYamlScalarQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
