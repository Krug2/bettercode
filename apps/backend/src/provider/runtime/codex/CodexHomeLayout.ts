import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expandHomePath } from "../../../pathExpansion"

export interface CodexHomeLayout {
  readonly mode: "direct" | "authOverlay"
  readonly runtimeHome: string | null
  readonly authHome: string | null
  readonly sharedHome: string
  readonly continuationKey: string
}

export class CodexShadowHomeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "CodexShadowHomeError"
  }
}

// These names are Codex's on-disk protocol, including the distinct log/logs paths.
const sharedDirectories = [
  "sessions",
  "archived_sessions",
  "sqlite",
  "shell_snapshots",
  "worktrees",
  "skills",
  "plugins",
  "cache",
  "logs",
]

function configuredPath(value: string | null | undefined): string | null {
  return value?.trim() ? path.resolve(expandHomePath(value.trim())) : null
}

export function resolveCodexHomeLayout(input: {
  readonly homePath?: string | null
  readonly shadowHomePath?: string | null
}): CodexHomeLayout {
  const configured =
    configuredPath(input.homePath) ?? configuredPath(process.env.CODEX_HOME)
  const sharedHome = configured ?? path.join(os.homedir(), ".codex")
  const overlay = configuredPath(input.shadowHomePath)
  if (overlay) materializeCodexShadowHome(sharedHome, overlay)
  return {
    sharedHome,
    mode: overlay ? "authOverlay" : "direct",
    runtimeHome: overlay ?? configured,
    authHome: overlay ?? configured,
    // Existing sessions must keep their identity when an auth overlay changes.
    continuationKey: `codex:home:${sharedHome}`,
  }
}

function missingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT"
}

function inspectEntry(
  location: string,
  followLink = false
): fs.Stats | undefined {
  try {
    return followLink ? fs.statSync(location) : fs.lstatSync(location)
  } catch (error) {
    if (missingFile(error)) return
    throw error
  }
}

function physicalPath(location: string): string {
  try {
    return fs.realpathSync(location)
  } catch (error) {
    if (!missingFile(error)) throw error
    const parent = path.dirname(location)
    if (parent === location) throw error
    return path.join(physicalPath(parent), path.basename(location))
  }
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  )
}

function entrySharing(name: string): "shared" | "auth" | "cache" | "local" {
  switch (process.platform === "win32" ? name.toLowerCase() : name) {
    case "auth.json":
      return "auth"
    case "models_cache.json":
      return "cache"
    case "log":
    case "tmp":
    case "memories":
      return "local"
    default:
      return "shared"
  }
}

interface OverlayPlan {
  createDirectories: string[]
  detachLinks: string[]
  attachLinks: Array<{
    source: string
    destination: string
    directory: boolean
  }>
}

function planOverlay(source: string, destination: string): OverlayPlan {
  const sourceIdentity = physicalPath(source)
  const destinationIdentity = physicalPath(destination)
  if (
    containsPath(sourceIdentity, destinationIdentity) ||
    containsPath(destinationIdentity, sourceIdentity)
  ) {
    throw new CodexShadowHomeError(
      "Codex shared and shadow homes must be different, non-overlapping directories."
    )
  }
  for (const root of [source, destination]) {
    const existing = inspectEntry(root, true)
    if (existing && !existing.isDirectory()) {
      throw new CodexShadowHomeError(
        `Codex home '${root}' must be a directory.`
      )
    }
  }

  const auth = path.join(destination, "auth.json")
  const authEntry = inspectEntry(auth)
  if (authEntry && (authEntry.isSymbolicLink() || !authEntry.isFile())) {
    throw new CodexShadowHomeError(
      `Codex shadow auth '${auth}' must be a real file.`
    )
  }

  const plan: OverlayPlan = {
    createDirectories: [],
    detachLinks: [],
    attachLinks: [],
  }
  const entries = new Map<string, boolean>()
  if (inspectEntry(source)) {
    for (const name of fs.readdirSync(source)) {
      if (entrySharing(name) === "shared") {
        const stat = inspectEntry(path.join(source, name), true)
        if (!stat)
          throw new CodexShadowHomeError(
            `Codex shared entry '${name}' has no accessible target.`
          )
        entries.set(name, stat.isDirectory())
      }
    }
  }
  for (const name of sharedDirectories) {
    const existingName =
      process.platform === "win32"
        ? [...entries.keys()].find((entry) => entry.toLowerCase() === name)
        : entries.has(name)
          ? name
          : undefined
    const entryName = existingName ?? name
    if (entries.get(entryName) === false) {
      throw new CodexShadowHomeError(
        `Codex shared entry '${name}' must be a directory.`
      )
    }
    if (!existingName) plan.createDirectories.push(path.join(source, name))
    entries.set(entryName, true)
  }

  for (const [name, directory] of entries) {
    const target = path.join(source, name)
    const link = path.join(destination, name)
    const existing = inspectEntry(link)
    if (existing) {
      if (!existing.isSymbolicLink()) {
        throw new CodexShadowHomeError(
          `Codex overlay entry '${link}' already exists and is not a symlink.`
        )
      }
      const linkedTarget = path.resolve(destination, fs.readlinkSync(link))
      if (
        path.relative(physicalPath(target), physicalPath(linkedTarget)) === ""
      )
        continue
      plan.detachLinks.push(link)
    }
    plan.attachLinks.push({ source: target, destination: link, directory })
  }

  const cache = path.join(destination, "models_cache.json")
  if (inspectEntry(cache)?.isSymbolicLink()) plan.detachLinks.push(cache)
  return plan
}

export function materializeCodexShadowHome(
  sourceHome: string,
  shadowHome: string
): void {
  const source = path.resolve(sourceHome)
  const destination = path.resolve(shadowHome)
  // Inspect the complete layout before touching it: a late conflict must not
  // partially rewire an existing account or detach its private model cache.
  const plan = planOverlay(source, destination)
  fs.mkdirSync(source, { recursive: true })
  fs.mkdirSync(destination, { recursive: true })
  for (const directory of plan.createDirectories)
    fs.mkdirSync(directory, { recursive: true })
  for (const link of plan.detachLinks) fs.unlinkSync(link)
  for (const link of plan.attachLinks) {
    const type = link.directory
      ? process.platform === "win32"
        ? "junction"
        : "dir"
      : "file"
    fs.symlinkSync(link.source, link.destination, type)
  }
}
