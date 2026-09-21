import fs from "node:fs/promises"
import path from "node:path"
import {
  readBoolean,
  readConfigValue,
  readStringRecord,
  readUnknownRecord,
} from "./formatters"
import {
  betterC0deHomeDir,
  expandHomePath,
  formatBetterC0deConfigSourcePath,
  invalidProjectPolicy,
  readBetterC0deProjectConfigs,
  readRecord,
  uniqueAbsolutePaths,
} from "./project-config"
import { readStringArray } from "./search"

export interface ProjectProviderModelTemplate {
  id: string
  name?: string
  family?: string
  releaseDate?: string
  sourcePath: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  toolCall?: boolean
  interleaved?: boolean
  interleavedField?: string
  experimental?: boolean
  status?: string
  contextLimit?: number
  inputLimit?: number
  outputLimit?: number
  inputModalities?: string[]
  outputModalities?: string[]
  cost?: Record<string, number>
  contextOver200kCost?: Record<string, number>
  providerApi?: string
  providerNpm?: string
  optionKeys: string[]
  headerKeys: string[]
  variants: string[]
  disabledVariants: string[]
}

export interface ProjectProviderTemplate {
  id: string
  name?: string
  sourcePath: string
  api?: string
  npm?: string
  env: string[]
  whitelist: string[]
  blacklist: string[]
  optionKeys: string[]
  hasApiKey: boolean
  baseURL?: string
  enterpriseUrl?: string
  setCacheKey?: boolean
  timeout?: number | false
  chunkTimeout?: number
  models: ProjectProviderModelTemplate[]
}

export interface ProjectProviderAuthTemplate {
  serviceId: string
  sourcePath: string
  accountCount: number
  credentialTypes: string[]
  activeAccountId?: string
  activeDescription?: string
  activeCredentialType?: string
  activeExpiresAt?: number
  activeExpired?: boolean
  metadataKeys?: string[]
}

export interface ProjectProvidersSummary {
  defaultModel?: string
  smallModel?: string
  enabledProviders: string[]
  disabledProviders: string[]
  providers: ProjectProviderTemplate[]
  authAccounts: ProjectProviderAuthTemplate[]
}

export interface ProjectModelDefaults {
  defaultModel?: string
  smallModel?: string
}

export async function listProjectProviders(
  cwd: string
): Promise<ProjectProvidersSummary> {
  const root = path.resolve(cwd)
  const providersById = new Map<string, ProjectProviderTemplate>()
  const enabledProviders = new Set<string>()
  const disabledProviders = new Set<string>()
  let defaultModel: string | undefined
  let smallModel: string | undefined

  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root,
    { strict: true }
  )) {
    validateProjectProviderPolicyConfig(config, sourcePath)
    defaultModel = readString(readConfigValue(config, "model")) ?? defaultModel
    smallModel =
      readString(readConfigValue(config, "small_model")) ?? smallModel
    for (const providerId of readStringArray(
      readConfigValue(config, "enabled_providers")
    )) {
      enabledProviders.add(providerId)
    }
    for (const providerId of readStringArray(
      readConfigValue(config, "disabled_providers")
    )) {
      disabledProviders.add(providerId)
    }
    for (const provider of projectProvidersFromConfig(
      readConfigValue(config, "provider"),
      sourcePath
    )) {
      providersById.set(provider.id, provider)
    }
  }

  return {
    ...(defaultModel ? { defaultModel } : {}),
    ...(smallModel ? { smallModel } : {}),
    enabledProviders: Array.from(enabledProviders).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    ),
    disabledProviders: Array.from(disabledProviders).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    ),
    providers: Array.from(providersById.values()).sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
    ),
    authAccounts: await readBetterC0deProviderAuthAccounts(),
  }
}

export async function getProjectModelDefaults(
  cwd: string
): Promise<ProjectModelDefaults> {
  const root = path.resolve(cwd)
  let defaultModel: string | undefined
  let smallModel: string | undefined

  for (const { config } of await readBetterC0deProjectConfigs(root)) {
    defaultModel = readString(readConfigValue(config, "model")) ?? defaultModel
    smallModel =
      readString(readConfigValue(config, "small_model")) ?? smallModel
  }

  return {
    ...(defaultModel ? { defaultModel } : {}),
    ...(smallModel ? { smallModel } : {}),
  }
}

async function readBetterC0deProviderAuthAccounts(): Promise<
  ProjectProviderAuthTemplate[]
> {
  const envAuth = readBetterC0deProviderAuthFromContent(
    process.env.BetterC0de_AUTH_CONTENT,
    "BetterC0de_AUTH_CONTENT"
  )
  if (envAuth.length > 0) return envAuth

  for (const dataDir of betterC0deDataDirectories()) {
    const authV2Path = path.join(dataDir, "auth-v2.json")
    const authV2 = await readBetterC0deProviderAuthFile(authV2Path)
    if (authV2.length > 0) return authV2

    const legacyPath = path.join(dataDir, "auth.json")
    const legacy = await readBetterC0deProviderAuthFile(legacyPath)
    if (legacy.length > 0) return legacy
  }

  return []
}

async function readBetterC0deProviderAuthFile(
  authPath: string
): Promise<ProjectProviderAuthTemplate[]> {
  try {
    const raw = await fs.readFile(authPath, "utf8")
    return readBetterC0deProviderAuthFromContent(
      raw,
      formatBetterC0deConfigSourcePath(authPath)
    )
  } catch {
    return []
  }
}

function readBetterC0deProviderAuthFromContent(
  raw: string | undefined,
  sourcePath: string
): ProjectProviderAuthTemplate[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return betterC0deProviderAuthFromParsed(parsed, sourcePath)
  } catch {
    return []
  }
}

function betterC0deProviderAuthFromParsed(
  parsed: unknown,
  sourcePath: string
): ProjectProviderAuthTemplate[] {
  const record = readUnknownRecord(parsed)
  if (readFiniteNumber(record.version) === 2) {
    return betterC0deProviderAuthFromV2(record, sourcePath)
  }
  return betterC0deProviderAuthFromLegacy(record, sourcePath)
}

function betterC0deProviderAuthFromV2(
  record: Record<string, unknown>,
  sourcePath: string
): ProjectProviderAuthTemplate[] {
  const accounts = readUnknownRecord(record.accounts)
  const active = readStringRecord(record.active)
  const byService = new Map<string, Record<string, unknown>[]>()
  for (const rawAccount of Object.values(accounts)) {
    const account = readUnknownRecord(rawAccount)
    const serviceId = readString(account.serviceID)
    if (!serviceId) continue
    const list = byService.get(serviceId) ?? []
    list.push(account)
    byService.set(serviceId, list)
  }

  return Array.from(byService.entries())
    .map(([serviceId, serviceAccounts]) => {
      const activeId = active[serviceId]
      const activeAccount =
        serviceAccounts.find(
          (account) => readString(account.id) === activeId
        ) ?? serviceAccounts[0]
      return projectProviderAuthTemplateFromAccounts(
        serviceId,
        serviceAccounts,
        activeAccount,
        sourcePath
      )
    })
    .sort((a, b) =>
      a.serviceId.localeCompare(b.serviceId, undefined, {
        sensitivity: "base",
      })
    )
}

function betterC0deProviderAuthFromLegacy(
  record: Record<string, unknown>,
  sourcePath: string
): ProjectProviderAuthTemplate[] {
  return Object.entries(record)
    .map(([serviceId, rawCredential]) =>
      projectProviderAuthTemplateFromAccounts(
        serviceId,
        [
          {
            id: serviceId,
            serviceID: serviceId,
            description: "legacy",
            credential: rawCredential,
          },
        ],
        {
          id: serviceId,
          serviceID: serviceId,
          description: "legacy",
          credential: rawCredential,
        },
        sourcePath
      )
    )
    .filter((auth): auth is ProjectProviderAuthTemplate =>
      Boolean(auth.activeCredentialType)
    )
    .sort((a, b) =>
      a.serviceId.localeCompare(b.serviceId, undefined, {
        sensitivity: "base",
      })
    )
}

function projectProviderAuthTemplateFromAccounts(
  serviceId: string,
  accounts: Record<string, unknown>[],
  activeAccount: Record<string, unknown> | undefined,
  sourcePath: string
): ProjectProviderAuthTemplate {
  const credentialTypes = Array.from(
    new Set(
      accounts
        .map((account) =>
          readString(readUnknownRecord(account.credential).type)
        )
        .filter((type): type is string => Boolean(type))
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  const credential = readUnknownRecord(activeAccount?.credential)
  const activeCredentialType = readString(credential.type)
  const activeExpiresAt = readFiniteNumber(credential.expires)
  const metadataKeys = Object.keys(readStringRecord(credential.metadata)).sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })
  )

  return {
    serviceId,
    sourcePath,
    accountCount: accounts.length,
    credentialTypes,
    ...(readString(activeAccount?.id)
      ? { activeAccountId: readString(activeAccount?.id) }
      : {}),
    ...(readString(activeAccount?.description)
      ? { activeDescription: readString(activeAccount?.description) }
      : {}),
    ...(activeCredentialType ? { activeCredentialType } : {}),
    ...(activeExpiresAt !== undefined ? { activeExpiresAt } : {}),
    ...(activeExpiresAt !== undefined
      ? { activeExpired: activeExpiresAt < Date.now() / 1000 }
      : {}),
    ...(metadataKeys.length > 0 ? { metadataKeys } : {}),
  }
}

function validateProjectProviderPolicyConfig(
  config: unknown,
  sourcePath: string
): void {
  validateProjectPolicyStringArray(
    readConfigValue(config, "enabled_providers"),
    `${sourcePath}#enabled_providers`
  )
  validateProjectPolicyStringArray(
    readConfigValue(config, "disabled_providers"),
    `${sourcePath}#disabled_providers`
  )

  const providerConfig = readConfigValue(config, "provider")
  if (providerConfig === undefined) return
  if (
    !providerConfig ||
    typeof providerConfig !== "object" ||
    Array.isArray(providerConfig)
  ) {
    throw invalidProjectPolicy(
      `${sourcePath}#provider`,
      "provider must be an object"
    )
  }
  for (const [providerId, rawProvider] of Object.entries(
    providerConfig as Record<string, unknown>
  )) {
    if (
      !rawProvider ||
      typeof rawProvider !== "object" ||
      Array.isArray(rawProvider)
    ) {
      throw invalidProjectPolicy(
        `${sourcePath}#provider.${providerId}`,
        "provider entry must be an object"
      )
    }
    const provider = rawProvider as Record<string, unknown>
    validateProjectPolicyStringArray(
      provider.whitelist,
      `${sourcePath}#provider.${providerId}.whitelist`
    )
    validateProjectPolicyStringArray(
      provider.blacklist,
      `${sourcePath}#provider.${providerId}.blacklist`
    )
  }
}

function validateProjectPolicyStringArray(
  value: unknown,
  location: string
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw invalidProjectPolicy(
      location,
      "must be an array of non-empty strings"
    )
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw invalidProjectPolicy(
        `${location}[${index}]`,
        "must be a non-empty string"
      )
    }
  }
}

function projectProvidersFromConfig(
  providerConfig: unknown,
  sourcePath: string
): ProjectProviderTemplate[] {
  if (
    !providerConfig ||
    typeof providerConfig !== "object" ||
    Array.isArray(providerConfig)
  ) {
    return []
  }

  return Object.entries(providerConfig as Record<string, unknown>)
    .map(([id, rawProvider]) =>
      projectProviderFromConfig(id, rawProvider, sourcePath)
    )
    .filter((provider): provider is ProjectProviderTemplate =>
      Boolean(provider)
    )
}

function projectProviderFromConfig(
  id: string,
  rawProvider: unknown,
  sourcePath: string
): ProjectProviderTemplate | null {
  if (
    !rawProvider ||
    typeof rawProvider !== "object" ||
    Array.isArray(rawProvider)
  ) {
    return null
  }

  const provider = rawProvider as Record<string, unknown>
  const options = readUnknownRecord(provider.options)
  const models = readRecord(provider, "models")
  return {
    id,
    name: readString(provider.name),
    sourcePath: `${sourcePath}#provider.${id}`,
    api: readString(provider.api),
    npm: readString(provider.npm),
    env: readStringArray(provider.env),
    whitelist: readStringArray(provider.whitelist),
    blacklist: readStringArray(provider.blacklist),
    optionKeys: Object.keys(options).sort(),
    hasApiKey: Object.prototype.hasOwnProperty.call(options, "apiKey"),
    baseURL: readString(options.baseURL),
    enterpriseUrl: readString(options.enterpriseUrl),
    setCacheKey: readBoolean(options.setCacheKey),
    timeout: readPositiveIntegerOrFalse(options.timeout),
    chunkTimeout: readPositiveInteger(options.chunkTimeout),
    models: Object.entries(models)
      .map(([modelId, rawModel]) =>
        projectProviderModelFromConfig(id, modelId, rawModel, sourcePath)
      )
      .filter((model): model is ProjectProviderModelTemplate => Boolean(model))
      .sort((a, b) =>
        a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
      ),
  }
}

function projectProviderModelFromConfig(
  providerId: string,
  modelId: string,
  rawModel: unknown,
  sourcePath: string
): ProjectProviderModelTemplate | null {
  if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) {
    return null
  }

  const model = rawModel as Record<string, unknown>
  const limit = readUnknownRecord(model.limit)
  const modalities = readUnknownRecord(model.modalities)
  const inputModalities = readStringArray(modalities.input)
  const outputModalities = readStringArray(modalities.output)
  const cost = readBetterC0deProviderModelCost(model.cost)
  const contextOver200kCost = readBetterC0deProviderModelCost(
    readUnknownRecord(model.cost).context_over_200k
  )
  const provider = readUnknownRecord(model.provider)
  const interleaved = readBetterC0deProviderModelInterleaved(model.interleaved)
  const variants = readRecord(model, "variants")
  const variantNames = Object.keys(variants).sort()
  const disabledVariants = variantNames.filter((name) => {
    const variant = variants[name]
    return (
      Boolean(variant) &&
      typeof variant === "object" &&
      !Array.isArray(variant) &&
      readBoolean((variant as Record<string, unknown>).disabled) === true
    )
  })
  return {
    id: readString(model.id) ?? modelId,
    name: readString(model.name),
    family: readString(model.family),
    releaseDate: readString(model.release_date),
    sourcePath: `${sourcePath}#provider.${providerId}.models.${modelId}`,
    attachment: readBoolean(model.attachment),
    reasoning: readBoolean(model.reasoning),
    temperature: readBoolean(model.temperature),
    toolCall: readBoolean(model.tool_call),
    interleaved: interleaved.enabled,
    interleavedField: interleaved.field,
    experimental: readBoolean(model.experimental),
    status: readString(model.status),
    contextLimit: readFiniteNumber(limit.context),
    inputLimit: readFiniteNumber(limit.input),
    outputLimit: readFiniteNumber(limit.output),
    ...(inputModalities.length > 0 ? { inputModalities } : {}),
    ...(outputModalities.length > 0 ? { outputModalities } : {}),
    ...(Object.keys(cost).length > 0 ? { cost } : {}),
    ...(Object.keys(contextOver200kCost).length > 0
      ? { contextOver200kCost }
      : {}),
    providerApi: readString(provider.api),
    providerNpm: readString(provider.npm),
    optionKeys: Object.keys(readUnknownRecord(model.options)).sort(),
    headerKeys: Object.keys(readStringRecord(model.headers)).sort(),
    variants: variantNames,
    disabledVariants,
  }
}

function readBetterC0deProviderModelCost(
  value: unknown
): Record<string, number> {
  const record = readUnknownRecord(value)
  const out: Record<string, number> = {}
  for (const key of ["input", "output", "cache_read", "cache_write"]) {
    const numeric = readFiniteNumber(record[key])
    if (typeof numeric === "number") out[key] = numeric
  }
  return out
}

function readBetterC0deProviderModelInterleaved(value: unknown): {
  enabled?: boolean
  field?: string
} {
  if (typeof value === "boolean") return { enabled: value }
  const record = readUnknownRecord(value)
  const field = readString(record.field)
  if (field) return { enabled: true, field }
  return {}
}

export function betterC0deDataDirectories(): string[] {
  const explicitXdgData = process.env.XDG_DATA_HOME?.trim()
  const dirs = [
    ...(explicitXdgData
      ? [
          path.join(
            path.resolve(expandHomePath(explicitXdgData)),
            "betterc0de"
          ),
          path.join(
            path.resolve(expandHomePath(explicitXdgData)),
            "BetterC0de"
          ),
        ]
      : []),
  ]
  switch (process.platform) {
    case "darwin":
      dirs.push(
        path.join(
          betterC0deHomeDir(),
          "Library",
          "Application Support",
          "betterc0de"
        )
      )
      dirs.push(
        path.join(
          betterC0deHomeDir(),
          "Library",
          "Application Support",
          "BetterC0de"
        )
      )
      break
    case "win32":
      dirs.push(
        path.join(
          process.env.LOCALAPPDATA ||
            path.join(betterC0deHomeDir(), "AppData", "Local"),
          "BetterC0de"
        )
      )
      dirs.push(
        path.join(
          process.env.LOCALAPPDATA ||
            path.join(betterC0deHomeDir(), "AppData", "Local"),
          "BetterC0de"
        )
      )
      break
  }
  dirs.push(path.join(betterC0deHomeDir(), ".local", "share", "betterc0de"))
  dirs.push(path.join(betterC0deHomeDir(), ".local", "share", "BetterC0de"))
  return uniqueAbsolutePaths(dirs)
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined
}

function readPositiveIntegerOrFalse(
  value: unknown
): number | false | undefined {
  if (value === false) return false
  return readPositiveInteger(value)
}
