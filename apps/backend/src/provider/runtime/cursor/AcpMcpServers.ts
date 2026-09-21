import { isRecord } from "@betterc0de/schema"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  listProjectMcpServers,
  type ProjectMcpServerTemplate,
} from "../../../services/workspace"
import { logger } from "../../../observability/logger"

/**
 * ACP's MCP wire types. These mirror the protocol's generated schema:
 * stdio servers intentionally have no `type` discriminator, while remote
 * servers use `http` or `sse`.
 */
export type AcpMcpServer =
  | {
      readonly name: string
      readonly command: string
      readonly args: ReadonlyArray<string>
      readonly env: ReadonlyArray<{
        readonly name: string
        readonly value: string
      }>
    }
  | {
      readonly type: "http" | "sse"
      readonly name: string
      readonly url: string
      readonly headers: ReadonlyArray<{
        readonly name: string
        readonly value: string
      }>
    }

export type AcpMcpServerResolver = (
  cwd: string
) => Promise<ReadonlyArray<AcpMcpServer>>

export type PortableMcpServer =
  | {
      readonly id: string
      readonly name: string
      readonly transport: "stdio"
      readonly command: string
      readonly args: ReadonlyArray<string>
      readonly env: Readonly<Record<string, string>>
    }
  | {
      readonly id: string
      readonly name: string
      readonly transport: "http" | "sse"
      readonly url: string
      readonly headers: Readonly<Record<string, string>>
    }

export type PortableMcpServerResolver = (
  cwd: string
) => Promise<ReadonlyArray<PortableMcpServer>>

interface ImportedRuntimeMcpServer {
  readonly id: string
  readonly name: string
  readonly type: "command" | "http" | "sse"
  readonly command: string
  readonly url: string | null
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
  readonly headerEnv: Readonly<Record<string, string>>
  readonly enabled: boolean
  readonly requiresExternalAuth: boolean
}

export interface SettingsMcpServerInput {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly args?: string
  readonly envVars?: string
  readonly enabled?: boolean
}

export interface ResolveMcpServersOptions {
  readonly importedStorePath?: string | null
  readonly dataDir?: string | null
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly settingsServers?: ReadonlyArray<SettingsMcpServerInput>
  readonly resolveSettingsServers?: () =>
    | Promise<ReadonlyArray<SettingsMcpServerInput>>
    | ReadonlyArray<SettingsMcpServerInput>
  readonly resolveProjectServers?: (
    cwd: string
  ) => Promise<ReadonlyArray<ProjectMcpServerTemplate>>
  /**
   * Whether this workspace may contribute MCP servers that BetterC0de will
   * *spawn* (`type: "local"` → a stdio child process).
   *
   * Project MCP config is read out of the opened repository, so a committed
   * `betterc0de.json` can name any command on the machine; without this gate,
   * cloning a repository and sending one message was enough to execute it.
   * Defaults to refusing, so a caller that forgets to wire the policy fails
   * closed rather than silently spawning.
   */
  readonly allowWorkspaceSpawnedServers?: (cwd: string) => boolean
}

export type ResolveAcpMcpServersOptions = ResolveMcpServersOptions

const MAX_IMPORTED_STORE_BYTES = 4 * 1024 * 1024
const MAX_MCP_SERVERS = 128
const MAX_NAME_CHARS = 256
const MAX_COMMAND_OR_URL_CHARS = 4_096
const MAX_ARGS = 32
const MAX_ARG_CHARS = 2_048
const MAX_ENV_ENTRIES = 64
const MAX_ENV_KEY_CHARS = 128
const MAX_ENV_VALUE_CHARS = 8_192
const REDACTED_MCP_VALUE = "[REDACTED]"
const ENVIRONMENT_VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/

/**
 * Resolve enabled MCP servers into a provider-neutral transport model.
 *
 * Electron's CLI import/settings surface persists its normalized servers in
 * `mcp-servers.json`. BetterC0de's global/project configuration is resolved by
 * the backend workspace service. Precedence is imported runtime store,
 * backend settings, then project/global configuration. Project/global entries
 * therefore win on matching ids, matching the narrower-scope-last precedence
 * used by the workspace service.
 */
export async function resolvePortableMcpServers(
  cwd: string,
  options: ResolveMcpServersOptions = {}
): Promise<ReadonlyArray<PortableMcpServer>> {
  const importedStorePath =
    options.importedStorePath === undefined
      ? resolveImportedRuntimeMcpStorePath(options.dataDir)
      : options.importedStorePath
  const [imported, settings, project] = await Promise.all([
    importedStorePath
      ? readImportedRuntimeMcpServers(importedStorePath)
      : Promise.resolve([]),
    options.resolveSettingsServers
      ? Promise.resolve(options.resolveSettingsServers())
      : Promise.resolve(options.settingsServers ?? []),
    (options.resolveProjectServers ?? listProjectMcpServers)(cwd),
  ])

  const byId = new Map<string, PortableMcpServer>()
  for (const server of imported) {
    const mapped = importedRuntimeMcpServerToPortable(
      server,
      options.environment ?? process.env
    )
    if (mapped) byId.set(normalizeServerKey(mapped.id), mapped)
  }
  for (const server of settings) {
    const mapped = settingsMcpServerToPortable(server)
    if (mapped) byId.set(normalizeServerKey(mapped.id), mapped)
  }
  const maySpawnWorkspaceServers =
    options.allowWorkspaceSpawnedServers?.(cwd) === true
  for (const server of project) {
    // `local` means "spawn this command line". Only an explicitly trusted
    // workspace gets to choose that; remote (http/sse) project entries still
    // apply because they cannot start a process.
    if (server.type === "local" && !maySpawnWorkspaceServers) {
      logger.warn(
        { sourcePath: server.sourcePath, serverId: server.id },
        "ignoring workspace-declared MCP server that would spawn a process — workspace is not explicitly trusted"
      )
      continue
    }
    const mapped = projectMcpServerToPortable(server)
    if (mapped) byId.set(normalizeServerKey(mapped.id), mapped)
  }

  return [...byId.values()]
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      })
    )
    .slice(0, MAX_MCP_SERVERS)
}

export async function resolveAcpMcpServers(
  cwd: string,
  options: ResolveMcpServersOptions = {}
): Promise<ReadonlyArray<AcpMcpServer>> {
  return portableMcpServersToAcp(await resolvePortableMcpServers(cwd, options))
}

export function portableMcpServersToAcp(
  servers: ReadonlyArray<PortableMcpServer>
): ReadonlyArray<AcpMcpServer> {
  return servers.map(portableMcpServerToAcp)
}

export function createPortableMcpServerResolver(
  options: ResolveMcpServersOptions
): PortableMcpServerResolver {
  return (cwd) => resolvePortableMcpServers(cwd, options)
}

export function createAcpMcpServerResolver(
  options: ResolveMcpServersOptions
): AcpMcpServerResolver {
  return (cwd) => resolveAcpMcpServers(cwd, options)
}

/**
 * Redact MCP transport secrets before ACP protocol events enter native trace
 * logs. The actual JSON-RPC payload is not modified.
 */
export function redactAcpMcpSecrets(payload: unknown): unknown {
  if (!isRecord(payload)) return payload
  const params = payload.params
  if (!isRecord(params) || !Array.isArray(params.mcpServers)) return payload

  return {
    ...payload,
    params: {
      ...params,
      mcpServers: params.mcpServers.map((server) => {
        if (!isRecord(server)) return server
        return {
          ...server,
          ...(Array.isArray(server.env)
            ? {
                env: server.env.map((entry) =>
                  isRecord(entry) && "value" in entry
                    ? { ...entry, value: REDACTED_MCP_VALUE }
                    : entry
                ),
              }
            : {}),
          ...(Array.isArray(server.headers)
            ? {
                headers: server.headers.map((entry) =>
                  isRecord(entry) && "value" in entry
                    ? { ...entry, value: REDACTED_MCP_VALUE }
                    : entry
                ),
              }
            : {}),
        }
      }),
    },
  }
}

function resolveImportedRuntimeMcpStorePath(
  configuredDataDir?: string | null
): string {
  // The desktop store belongs to the runtime base, while DATA_DIR overrides
  // only backend userdata. Keep an explicit HOME authoritative for both halves.
  const homeOverride = process.env.BETTERC0DE_HOME?.trim()
  if (homeOverride) return path.join(path.resolve(homeOverride), "mcp-servers.json")

  const explicitDataDir =
    configuredDataDir?.trim() || process.env.BETTERC0DE_DATA_DIR?.trim()
  if (explicitDataDir) {
    const resolved = path.resolve(explicitDataDir)
    return path.join(
      path.basename(resolved).toLowerCase() === "userdata"
        ? path.dirname(resolved)
        : resolved,
      "mcp-servers.json"
    )
  }

  const runtimeRoot = path.join(os.homedir(), ".betterc0de")
  return path.join(runtimeRoot, "mcp-servers.json")
}

async function readImportedRuntimeMcpServers(
  filePath: string
): Promise<ReadonlyArray<ImportedRuntimeMcpServer>> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    const entry = await fs.lstat(filePath)
    if (!entry.isFile() || entry.isSymbolicLink()) return []
    handle = await fs.open(filePath, "r")
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      stat.size < 2 ||
      stat.size > MAX_IMPORTED_STORE_BYTES
    ) {
      return []
    }
    const buffer = Buffer.allocUnsafe(stat.size)
    const { bytesRead } = await handle.read(buffer, 0, stat.size, 0)
    if (bytesRead !== stat.size) return []
    const parsed: unknown = JSON.parse(buffer.toString("utf8"))
    if (!Array.isArray(parsed)) return []
    return parsed
      .slice(0, MAX_MCP_SERVERS)
      .map(parseImportedRuntimeMcpServer)
      .filter((server): server is ImportedRuntimeMcpServer => server !== null)
  } catch {
    // The desktop compatibility store is optional. A missing/corrupt store
    // must not prevent project-configured MCP servers from being resolved.
    return []
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function parseImportedRuntimeMcpServer(
  value: unknown
): ImportedRuntimeMcpServer | null {
  if (!isRecord(value) || value.enabled === false) return null
  const id = boundedNonEmptyString(value.id, MAX_NAME_CHARS)
  const name =
    boundedNonEmptyString(value.name, MAX_NAME_CHARS) ??
    boundedNonEmptyString(value.id, MAX_NAME_CHARS)
  if (!id || !name) return null

  const rawType = boundedNonEmptyString(value.type, 32) ?? "command"
  const type =
    rawType === "sse" ? "sse" : rawType === "command" ? "command" : "http"
  const command =
    boundedNonEmptyString(value.command, MAX_COMMAND_OR_URL_CHARS) ?? ""
  const url = boundedNonEmptyString(value.url, MAX_COMMAND_OR_URL_CHARS) ?? null
  if (type === "command" ? !command : !url) return null

  const args = boundedStringArray(value.args, MAX_ARGS, MAX_ARG_CHARS)
  const env = boundedStringRecord(value.env)
  const headers =
    value.headers === undefined ? {} : boundedHttpHeaderRecord(value.headers)
  const headerEnv =
    value.headerEnv === undefined
      ? {}
      : boundedHttpHeaderRecord(value.headerEnv, {
          environmentReferences: true,
        })
  if (!args || !env || !headers || !headerEnv) return null
  if (
    type === "command" &&
    (Object.keys(headers).length > 0 || Object.keys(headerEnv).length > 0)
  ) {
    return null
  }
  return {
    id,
    name,
    type,
    command,
    url,
    args,
    env,
    headers,
    headerEnv,
    enabled: true,
    requiresExternalAuth: rawType === "oauth" || value.authenticated === true,
  }
}

function importedRuntimeMcpServerToPortable(
  server: ImportedRuntimeMcpServer,
  environment: Readonly<Record<string, string | undefined>>
): PortableMcpServer | null {
  if (!server.enabled || server.requiresExternalAuth) return null
  if (server.type === "command") {
    return {
      id: server.id,
      name: server.name,
      transport: "stdio",
      command: server.command,
      args: [...server.args],
      env: { ...server.env },
    }
  }
  if (!server.url) return null
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(server.env)) {
    if (!setHttpHeader(headers, name, value)) return null
  }
  for (const [name, value] of Object.entries(server.headers)) {
    if (!setHttpHeader(headers, name, value)) return null
  }
  for (const [name, environmentVariable] of Object.entries(server.headerEnv)) {
    const value = environment[environmentVariable]
    // Environment-backed authentication must fail closed. Omitting a missing
    // header could silently connect to a different anonymous/public identity.
    if (
      typeof value !== "string" ||
      value.length > MAX_ENV_VALUE_CHARS ||
      !setHttpHeader(headers, name, value)
    ) {
      return null
    }
  }
  return {
    id: server.id,
    name: server.name,
    transport: server.type,
    url: server.url,
    headers,
  }
}

function settingsMcpServerToPortable(
  server: SettingsMcpServerInput
): PortableMcpServer | null {
  if (server.enabled === false) return null
  const id = boundedNonEmptyString(server.id, MAX_NAME_CHARS)
  const name =
    boundedNonEmptyString(server.name, MAX_NAME_CHARS) ??
    boundedNonEmptyString(server.id, MAX_NAME_CHARS)
  const command = boundedNonEmptyString(
    server.command,
    MAX_COMMAND_OR_URL_CHARS
  )
  const args = parseSettingsArgs(server.args ?? "")
  const env = parseSettingsEnvironment(server.envVars ?? "")
  if (!id || !name || !command || !args || !env) return null
  return {
    id,
    name,
    transport: "stdio",
    command,
    args,
    env,
  }
}

function projectMcpServerToPortable(
  server: ProjectMcpServerTemplate
): PortableMcpServer | null {
  if (!server.enabled) return null
  const id = boundedNonEmptyString(server.id, MAX_NAME_CHARS)
  const name =
    boundedNonEmptyString(server.name, MAX_NAME_CHARS) ??
    boundedNonEmptyString(server.id, MAX_NAME_CHARS)
  if (!id || !name) return null

  if (server.type === "local") {
    const command = boundedNonEmptyString(
      server.command,
      MAX_COMMAND_OR_URL_CHARS
    )
    const args = boundedStringArray(server.args, MAX_ARGS, MAX_ARG_CHARS)
    const env = boundedStringRecord(server.env)
    if (!command || !args || !env) return null
    return {
      id,
      name,
      transport: "stdio",
      command,
      args,
      env,
    }
  }

  // The portable project descriptor intentionally exposes OAuth status but
  // never token values. Forwarding an explicitly OAuth-configured endpoint
  // would therefore silently discard its credentials.
  if (server.oauth === "configured") return null
  const url = boundedNonEmptyString(
    server.url ?? server.command,
    MAX_COMMAND_OR_URL_CHARS
  )
  const headers = boundedStringRecord(server.env)
  if (!url || !headers) return null
  return {
    id,
    name,
    transport: "http",
    url,
    headers,
  }
}

function portableMcpServerToAcp(server: PortableMcpServer): AcpMcpServer {
  if (server.transport === "stdio") {
    return {
      name: server.name,
      command: server.command,
      args: [...server.args],
      env: recordEntries(server.env),
    }
  }
  return {
    type: server.transport,
    name: server.name,
    url: server.url,
    headers: recordEntries(server.headers),
  }
}

function parseSettingsArgs(value: string): string[] | null {
  if (value.length > MAX_ARGS * MAX_ARG_CHARS) return null
  const args: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3] ?? "")
    if (args.length > MAX_ARGS) return null
  }
  return boundedStringArray(args, MAX_ARGS, MAX_ARG_CHARS)
}

function parseSettingsEnvironment(
  value: string
): Record<string, string> | null {
  if (value.length > MAX_ENV_ENTRIES * MAX_ENV_VALUE_CHARS) return null
  const env: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const entryValue = trimmed.slice(separator + 1).trim()
    if (key) env[key] = entryValue
  }
  return boundedStringRecord(env)
}

function recordEntries(
  value: Readonly<Record<string, string>>
): ReadonlyArray<{ readonly name: string; readonly value: string }> {
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entryValue]) => ({ name, value: entryValue }))
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxChars: number
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null
  const output: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > maxChars) return null
    output.push(entry)
  }
  return output
}

function boundedStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  if (entries.length > MAX_ENV_ENTRIES) return null
  const output: Record<string, string> = {}
  for (const [key, entryValue] of entries) {
    if (
      !key ||
      key.length > MAX_ENV_KEY_CHARS ||
      typeof entryValue !== "string" ||
      entryValue.length > MAX_ENV_VALUE_CHARS
    ) {
      return null
    }
    Object.defineProperty(output, key, {
      value: entryValue,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return output
}

function boundedHttpHeaderRecord(
  value: unknown,
  options: { readonly environmentReferences?: boolean } = {}
): Record<string, string> | null {
  const record = boundedStringRecord(value)
  if (!record) return null
  for (const [name, entryValue] of Object.entries(record)) {
    if (
      !HTTP_HEADER_NAME_RE.test(name) ||
      (options.environmentReferences
        ? !ENVIRONMENT_VARIABLE_NAME_RE.test(entryValue)
        : /[\0\r\n]/.test(entryValue))
    ) {
      return null
    }
  }
  return record
}

function setHttpHeader(
  target: Record<string, string>,
  name: string,
  value: string
): boolean {
  if (!HTTP_HEADER_NAME_RE.test(name) || /[\0\r\n]/.test(value)) return false
  const normalizedName = name.toLocaleLowerCase("en-US")
  for (const existingName of Object.keys(target)) {
    if (existingName.toLocaleLowerCase("en-US") === normalizedName) {
      delete target[existingName]
      break
    }
  }
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return true
}

function boundedNonEmptyString(
  value: unknown,
  maxChars: number
): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxChars ? trimmed : null
}

function normalizeServerKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US")
}
