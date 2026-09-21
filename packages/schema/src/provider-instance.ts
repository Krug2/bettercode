import { z } from "zod"
import { modelCapabilitiesSchema } from "./model-selection"
import { secretStateSchema } from "./secret"

const PROVIDER_SLUG_MAX_CHARS = 64
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/
const ENVIRONMENT_VARIABLE_NAME_MAX_CHARS = 128
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const SENSITIVE_PROVIDER_FIELD_PATTERN =
  /(?:^|_)(?:api_key|access_key|private_key|token|secret|password|passwd|credentials?|authorization|connection_string|dsn)(?:_|$)/

export function isSensitiveProviderFieldName(name: string): boolean {
  const normalized = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
  return SENSITIVE_PROVIDER_FIELD_PATTERN.test(normalized)
}

const providerSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROVIDER_SLUG_MAX_CHARS)
  .regex(
    PROVIDER_SLUG_PATTERN,
    "provider slug must start with a letter and contain only letters, digits, dashes, or underscores"
  )

export type ProviderInstanceId = string & {
  readonly __brand: "ProviderInstanceId"
}
export type ProviderDriverKind = string

export const providerInstanceId = (value: string): ProviderInstanceId =>
  value as ProviderInstanceId

export const providerDriverKind = (value: string): ProviderDriverKind => value

export const providerInstanceIdSchema = providerSlugSchema

export const providerDriverKindSchema = providerSlugSchema

export const providerInstanceEnvironmentVariableSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(ENVIRONMENT_VARIABLE_NAME_MAX_CHARS)
      .regex(
        ENVIRONMENT_VARIABLE_NAME_PATTERN,
        "environment variable names must start with a letter or underscore and contain only letters, digits, or underscores"
      ),
    value: z.string().default(""),
    sensitive: z.boolean().optional(),
    valueRedacted: z.boolean().optional(),
    secretState: secretStateSchema.optional(),
  })
  .transform((entry) => ({
    ...entry,
    sensitive:
      entry.sensitive === true || isSensitiveProviderFieldName(entry.name),
  }))
export type ProviderInstanceEnvironmentVariable = z.infer<
  typeof providerInstanceEnvironmentVariableSchema
>

export const providerInstanceConfigSchema = z.object({
  instanceId: providerInstanceIdSchema,
  driver: providerDriverKindSchema,
  displayName: z.string().trim().min(1).optional(),
  accentColor: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
  environment: z.array(providerInstanceEnvironmentVariableSchema).default([]),
  config: z.unknown().default({}),
})
export type ProviderInstanceConfig = z.infer<
  typeof providerInstanceConfigSchema
>

export const providerInstanceConfigMapSchema = z
  .preprocess(
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
      const out: Record<string, unknown> = {}
      for (const [instanceId, value] of Object.entries(
        raw as Record<string, unknown>
      )) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          out[instanceId] = {
            ...(value as Record<string, unknown>),
            instanceId,
          }
        } else {
          out[instanceId] = value
        }
      }
      return out
    },
    z.record(providerInstanceIdSchema, providerInstanceConfigSchema)
  )
  .default({})
export type ProviderInstanceConfigMap = z.infer<
  typeof providerInstanceConfigMapSchema
>

export const providerModelCatalogSchema = z.object({
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  api: z
    .object({
      id: z.string().trim().min(1).optional(),
      url: z.string().trim().min(1).optional(),
      package: z.string().trim().min(1).optional(),
    })
    .optional(),
  status: z.string().trim().min(1).optional(),
  releaseDate: z.string().trim().min(1).optional(),
  limit: z
    .object({
      context: z.number().finite().nonnegative().optional(),
      input: z.number().finite().nonnegative().optional(),
      output: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  cost: z
    .object({
      input: z.number().finite().nonnegative().optional(),
      output: z.number().finite().nonnegative().optional(),
      cache: z
        .object({
          read: z.number().finite().nonnegative().optional(),
          write: z.number().finite().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  variants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})
export type ProviderModelCatalog = z.infer<typeof providerModelCatalogSchema>

export const providerCatalogEndpointSchema = z.object({
  type: z.string().trim().min(1),
  url: z.string().trim().min(1).optional(),
  package: z.string().trim().min(1).optional(),
  websocket: z.boolean().optional(),
})
export type ProviderCatalogEndpoint = z.infer<
  typeof providerCatalogEndpointSchema
>

export const providerCatalogEntrySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  connected: z.boolean().default(false),
  enabled: z.boolean().default(false),
  enabledVia: z.string().trim().min(1).optional(),
  env: z.array(z.string().trim().min(1)).default([]),
  endpoint: providerCatalogEndpointSchema.optional(),
  modelCount: z.number().int().nonnegative().optional(),
})
export type ProviderCatalogEntry = z.infer<typeof providerCatalogEntrySchema>

export const providerInstanceModelSchema = z.object({
  slug: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  subProvider: z.string().optional(),
  isCustom: z.boolean().default(false),
  capabilities: modelCapabilitiesSchema.nullable().default(null),
  context: z.string().optional(),
  tier: z.string().optional(),
  catalog: providerModelCatalogSchema.optional(),
})

export const providerSlashCommandInputSchema = z.object({
  hint: z.string().trim().min(1),
})
export type ProviderSlashCommandInput = z.infer<
  typeof providerSlashCommandInputSchema
>

export const providerSlashCommandSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  input: providerSlashCommandInputSchema.optional(),
})
export type ProviderSlashCommand = z.infer<typeof providerSlashCommandSchema>

export const providerSkillSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1),
  scope: z.string().trim().min(1).optional(),
  enabled: z.boolean(),
  displayName: z.string().trim().min(1).optional(),
  shortDescription: z.string().trim().min(1).optional(),
  /** CLI plugin that bundles this skill (`name@marketplace`), when any. */
  pluginId: z.string().trim().min(1).optional(),
})
export type ProviderSkill = z.infer<typeof providerSkillSchema>

export const providerAgentSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  hidden: z.boolean().default(false),
  displayName: z.string().trim().min(1).optional(),
})
export type ProviderAgent = z.infer<typeof providerAgentSchema>

export const providerToolSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).optional(),
  parameters: z.unknown().optional(),
})
export type ProviderTool = z.infer<typeof providerToolSchema>

export const providerInstanceMetadataSchema = z.object({
  checkedAt: z.number().int().nonnegative().nullable().optional(),
  skillsError: z.string().optional(),
  slashCommandsError: z.string().optional(),
  agentsError: z.string().optional(),
  toolsError: z.string().optional(),
  providerCatalogError: z.string().optional(),
})
export type ProviderInstanceMetadata = z.infer<
  typeof providerInstanceMetadataSchema
>

export const providerInstanceAvailabilitySchema = z.enum([
  "available",
  "unavailable",
])
export type ProviderInstanceAvailability = z.infer<
  typeof providerInstanceAvailabilitySchema
>

export const providerInstanceStatusSchema = z.enum([
  "ready",
  "warning",
  "error",
  "disabled",
])
export type ProviderInstanceStatus = z.infer<
  typeof providerInstanceStatusSchema
>

export const providerInstanceAuthStatusSchema = z.enum([
  "authenticated",
  "unauthenticated",
  "unknown",
])
export type ProviderInstanceAuthStatus = z.infer<
  typeof providerInstanceAuthStatusSchema
>

export const providerInstanceAuthSchema = z.object({
  status: providerInstanceAuthStatusSchema,
  type: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
})
export type ProviderInstanceAuth = z.infer<typeof providerInstanceAuthSchema>

export const providerInstanceContinuationSchema = z.object({
  groupKey: z.string().trim().min(1),
})
export type ProviderInstanceContinuation = z.infer<
  typeof providerInstanceContinuationSchema
>

export const providerInstanceVersionAdvisorySchema = z.object({
  status: z.enum(["unknown", "current", "behind_latest"]),
  currentVersion: z.string().trim().min(1).nullable(),
  latestVersion: z.string().trim().min(1).nullable(),
  updateCommand: z.string().trim().min(1).nullable(),
  canUpdate: z.boolean().default(false),
  checkedAt: z.string().datetime().nullable(),
  message: z.string().trim().min(1).nullable(),
})
export type ProviderInstanceVersionAdvisory = z.infer<
  typeof providerInstanceVersionAdvisorySchema
>

export const providerInstanceUpdateStateSchema = z.object({
  status: z.enum([
    "idle",
    "queued",
    "running",
    "succeeded",
    "failed",
    "unchanged",
  ]),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  message: z.string().trim().min(1).nullable(),
  output: z.string().max(10_000).nullable(),
})
export type ProviderInstanceUpdateState = z.infer<
  typeof providerInstanceUpdateStateSchema
>

const providerInstanceSnapshotBaseSchema = providerInstanceConfigSchema.extend({
  config: z.record(z.string(), z.unknown()).default({}),
  configured: z.boolean(),
  badgeLabel: z.string().trim().min(1).optional(),
  continuation: providerInstanceContinuationSchema.optional(),
  showInteractionModeToggle: z.boolean().optional(),
  installed: z.boolean(),
  version: z.string().trim().min(1).nullable().default(null),
  status: providerInstanceStatusSchema,
  auth: providerInstanceAuthSchema,
  checkedAt: z.string().datetime(),
  message: z.string().trim().min(1).optional(),
  availability: providerInstanceAvailabilitySchema.default("available"),
  unavailableReason: z.string().optional(),
  continuationKey: z.string().optional(),
  models: z.array(providerInstanceModelSchema).default([]),
  providerCatalog: z.array(providerCatalogEntrySchema).default([]),
  slashCommands: z.array(providerSlashCommandSchema).default([]),
  skills: z.array(providerSkillSchema).default([]),
  agents: z.array(providerAgentSchema).default([]),
  tools: z.array(providerToolSchema).default([]),
  metadata: providerInstanceMetadataSchema.optional(),
  capabilities: z
    .object({
      supportsStreaming: z.boolean(),
      supportsTools: z.boolean(),
      supportsApprovals: z.boolean(),
      supportsResume: z.boolean(),
      managesOwnLifecycle: z.boolean(),
    })
    .optional(),
  versionAdvisory: providerInstanceVersionAdvisorySchema.optional(),
  updateState: providerInstanceUpdateStateSchema.optional(),
})

export const providerInstanceSnapshotSchema = z.preprocess(
  normalizeProviderInstanceSnapshotInput,
  providerInstanceSnapshotBaseSchema
)
export type ProviderInstanceSnapshot = z.infer<
  typeof providerInstanceSnapshotSchema
>

function normalizeProviderInstanceSnapshotInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const input = raw as Record<string, unknown>
  const availability =
    input.availability === "unavailable" ? "unavailable" : "available"
  const enabled = typeof input.enabled === "boolean" ? input.enabled : true
  const unavailableReason =
    typeof input.unavailableReason === "string" &&
    input.unavailableReason.trim().length > 0
      ? input.unavailableReason
      : undefined
  const installed =
    typeof input.installed === "boolean"
      ? input.installed
      : availability !== "unavailable" && !unavailableReason
  const status =
    typeof input.status === "string" &&
    providerInstanceStatusSchema.safeParse(input.status).success
      ? input.status
      : !enabled
        ? "disabled"
        : availability === "unavailable" || unavailableReason
          ? "error"
          : typeof input.configured === "boolean" && input.configured
            ? "ready"
            : "warning"
  const auth =
    input.auth && typeof input.auth === "object" && !Array.isArray(input.auth)
      ? input.auth
      : {
          status:
            typeof input.configured === "boolean" && input.configured
              ? "authenticated"
              : "unknown",
        }
  const configured =
    typeof input.configured === "boolean"
      ? input.configured
      : enabled &&
        installed &&
        availability !== "unavailable" &&
        status !== "disabled" &&
        status !== "error"
  const continuationKey =
    typeof input.continuationKey === "string"
      ? input.continuationKey
      : readContinuationGroupKey(input.continuation)
  const continuation =
    input.continuation && typeof input.continuation === "object"
      ? input.continuation
      : continuationKey
        ? { groupKey: continuationKey }
        : undefined

  return {
    ...input,
    enabled,
    configured,
    installed,
    status,
    auth,
    availability,
    checkedAt:
      typeof input.checkedAt === "string"
        ? input.checkedAt
        : new Date().toISOString(),
    ...(continuation ? { continuation } : {}),
    ...(continuationKey ? { continuationKey } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
  }
}

function readContinuationGroupKey(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const groupKey = (raw as { groupKey?: unknown }).groupKey
  return typeof groupKey === "string" ? groupKey : undefined
}
