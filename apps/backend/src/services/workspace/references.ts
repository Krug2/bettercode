import fs from "node:fs/promises"
import path from "node:path"
import {
  betterC0deHomeDir,
  readBetterC0deProjectConfigs,
  readRecord,
} from "./project-config"
import { readString } from "./providers"
import { workspaceRelativePath } from "./resources"

export interface ProjectReferenceTemplate {
  id: string
  name: string
  kind: "local" | "git" | "invalid"
  sourcePath: string
  path?: string
  relativePath?: string
  repository?: string
  branch?: string
  exists?: boolean
  message?: string
}

export async function listProjectReferences(
  cwd: string
): Promise<ProjectReferenceTemplate[]> {
  const root = path.resolve(cwd)
  const byId = new Map<string, ProjectReferenceTemplate>()

  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root
  )) {
    const referenceConfig = readRecord(config, "reference")
    for (const [name, rawReference] of Object.entries(referenceConfig)) {
      byId.set(
        name,
        await projectReferenceFromConfig(root, name, rawReference, sourcePath)
      )
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
  )
}

async function projectReferenceFromConfig(
  workspaceRoot: string,
  name: string,
  rawReference: unknown,
  sourcePath: string
): Promise<ProjectReferenceTemplate> {
  const source = `${sourcePath}#reference.${name}`
  const aliasError = validateBetterC0deReferenceAlias(name)
  if (aliasError) {
    return {
      id: name,
      name,
      kind: "invalid",
      sourcePath: source,
      message: aliasError,
    }
  }

  const normalized = normalizeBetterC0deReferenceEntry(rawReference)
  if (normalized.kind === "invalid") {
    return {
      id: name,
      name,
      kind: "invalid",
      sourcePath: source,
      message: normalized.message,
    }
  }

  if (normalized.kind === "git") {
    if (!isLikelyGitReference(normalized.repository)) {
      return {
        id: name,
        name,
        kind: "invalid",
        sourcePath: source,
        repository: normalized.repository,
        message:
          "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
      }
    }
    return {
      id: name,
      name,
      kind: "git",
      sourcePath: source,
      repository: normalized.repository,
      ...(normalized.branch ? { branch: normalized.branch } : {}),
    }
  }

  const resolved = resolveBetterC0deLocalReferencePath(
    workspaceRoot,
    normalized.path
  )
  if (!resolved.ok) {
    return {
      id: name,
      name,
      kind: "invalid",
      sourcePath: source,
      message: resolved.message,
    }
  }

  let exists = false
  try {
    exists = (await fs.stat(resolved.path)).isDirectory()
  } catch {
    exists = false
  }

  return {
    id: name,
    name,
    kind: "local",
    sourcePath: source,
    path: resolved.path,
    exists,
    ...workspaceRelativePath(workspaceRoot, resolved.path),
    ...(!exists
      ? { message: "Reference path does not exist or is not a directory yet" }
      : {}),
  }
}

type NormalizedProjectReferenceEntry =
  | { kind: "local"; path: string }
  | { kind: "git"; repository: string; branch?: string }
  | { kind: "invalid"; message: string }

function normalizeBetterC0deReferenceEntry(
  entry: unknown
): NormalizedProjectReferenceEntry {
  if (typeof entry === "string") {
    const value = entry.trim()
    if (!value) return { kind: "invalid", message: "Reference value is empty" }
    if (
      value.startsWith(".") ||
      value.startsWith("/") ||
      value.startsWith("~")
    ) {
      return { kind: "local", path: value }
    }
    return { kind: "git", repository: value }
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      kind: "invalid",
      message: "Reference must be a string, { path }, or { repository }",
    }
  }

  const record = entry as Record<string, unknown>
  const localPath = readString(record.path)
  if (localPath) return { kind: "local", path: localPath }

  const repository = readString(record.repository)
  if (repository) {
    const branch = readString(record.branch)
    return { kind: "git", repository, ...(branch ? { branch } : {}) }
  }

  return {
    kind: "invalid",
    message: "Reference must include either path or repository",
  }
}

function validateBetterC0deReferenceAlias(name: string): string | null {
  if (name.length === 0) return "Reference alias must not be empty"
  if (/[/\s`,]/.test(name)) {
    return "Reference alias must not contain /, whitespace, comma, or backtick"
  }
  return null
}

function resolveBetterC0deLocalReferencePath(
  workspaceRoot: string,
  value: string
): { ok: true; path: string } | { ok: false; message: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, message: "Local reference path is empty" }
  }

  let resolved: string
  if (trimmed.startsWith("~/")) {
    resolved = path.resolve(betterC0deHomeDir(), trimmed.slice(2))
  } else {
    resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(workspaceRoot, trimmed)
  }

  return { ok: true, path: resolved }
}

function isLikelyGitReference(repository: string): boolean {
  const value = repository.trim()
  if (!value) return false
  if (/^(https?|ssh):\/\/\S+$/i.test(value)) return true
  if (/^git@[^:\s]+:[^\s]+$/.test(value)) return true
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)) {
    return true
  }
  if (/^[A-Za-z0-9_.-]+\.[A-Za-z]{2,}\/[^\s]+$/.test(value)) return true
  return false
}
