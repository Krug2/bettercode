import { z } from "zod"

const trimmedNonEmpty = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long`)

export const agentPermissionBehaviorSchema = z.enum(["allow", "deny", "ask"])
export type AgentPermissionBehavior = z.infer<
  typeof agentPermissionBehaviorSchema
>

/**
 * Session grants remain ephemeral and are managed by the provider request
 * lifecycle. These are the two destinations for provider-neutral durable
 * grants.
 */
export const agentPermissionDestinationSchema = z.enum(["user", "workspace"])
export type AgentPermissionDestination = z.infer<
  typeof agentPermissionDestinationSchema
>

export const workspaceTrustStateSchema = z.enum(["trusted", "untrusted"])
export type WorkspaceTrustState = z.infer<typeof workspaceTrustStateSchema>

export const agentPermissionToolNameSchema = trimmedNonEmpty("toolName", 256)

/**
 * A grant path is always workspace-relative. The backend performs canonical
 * separator normalization and the final root-confinement check because that
 * requires the host platform's path implementation.
 */
export const agentPermissionPathScopeSchema = trimmedNonEmpty("pathScope", 2048)
  .refine((value) => !value.includes("\0"), "pathScope contains a NUL byte")
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/.test(value),
    "pathScope must be workspace-relative"
  )
  .refine(
    (value) =>
      !value
        .replaceAll("\\", "/")
        .split("/")
        .some((segment) => segment === ".."),
    "pathScope must stay inside the workspace"
  )

export const agentPermissionGrantSchema = z
  .object({
    id: trimmedNonEmpty("id", 128),
    destination: agentPermissionDestinationSchema,
    workspacePath: z.string().nullable(),
    toolName: agentPermissionToolNameSchema,
    pathScope: agentPermissionPathScopeSchema,
    behavior: agentPermissionBehaviorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
export type AgentPermissionGrant = z.infer<typeof agentPermissionGrantSchema>

export const agentPermissionGrantListSchema = z
  .object({
    workspacePath: z.string().trim().min(1).max(4096).nullable().optional(),
    destination: agentPermissionDestinationSchema.optional(),
    includeUser: z.boolean().optional().default(true),
  })
  .strict()
export type AgentPermissionGrantListBody = z.infer<
  typeof agentPermissionGrantListSchema
>

export const agentPermissionGrantUpsertSchema = z
  .object({
    destination: agentPermissionDestinationSchema,
    workspacePath: z.string().trim().min(1).max(4096).nullable().optional(),
    toolName: agentPermissionToolNameSchema,
    pathScope: agentPermissionPathScopeSchema.optional(),
    behavior: agentPermissionBehaviorSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.destination === "workspace" && !value.workspacePath) {
      ctx.addIssue({
        code: "custom",
        path: ["workspacePath"],
        message: "workspacePath is required for workspace grants",
      })
    }
    if (value.destination === "user" && value.workspacePath) {
      ctx.addIssue({
        code: "custom",
        path: ["workspacePath"],
        message: "workspacePath is not valid for user grants",
      })
    }
    if (value.behavior === "allow") {
      const scope = value.pathScope?.trim() ?? ""
      if (!scope || scope === "." || scope === "*") {
        ctx.addIssue({
          code: "custom",
          path: ["pathScope"],
          message:
            "Durable allow grants require a concrete path scope; '.' is match-all and is not allowed",
        })
      }
      if (value.toolName.trim() === "*") {
        ctx.addIssue({
          code: "custom",
          path: ["toolName"],
          message: "Durable allow grants cannot use a wildcard tool name",
        })
      }
    }
  })
export type AgentPermissionGrantUpsertBody = z.infer<
  typeof agentPermissionGrantUpsertSchema
>

export const agentPermissionGrantDeleteSchema = z
  .object({
    id: trimmedNonEmpty("id", 128),
  })
  .strict()
export type AgentPermissionGrantDeleteBody = z.infer<
  typeof agentPermissionGrantDeleteSchema
>

export const agentPermissionEvaluateSchema = z
  .object({
    workspacePath: z.string().trim().min(1).max(4096),
    toolName: agentPermissionToolNameSchema,
    path: z.string().trim().min(1).max(4096).nullable().optional(),
  })
  .strict()
export type AgentPermissionEvaluateBody = z.infer<
  typeof agentPermissionEvaluateSchema
>

export const workspaceTrustRecordSchema = z
  .object({
    workspacePath: z.string(),
    state: workspaceTrustStateSchema,
    explicit: z.boolean(),
    updatedAt: z.string().nullable(),
  })
  .strict()
export type WorkspaceTrustRecord = z.infer<typeof workspaceTrustRecordSchema>

export const workspaceTrustGetSchema = z
  .object({
    workspacePath: z.string().trim().min(1).max(4096),
  })
  .strict()
export type WorkspaceTrustGetBody = z.infer<typeof workspaceTrustGetSchema>

export const workspaceTrustSetSchema = z
  .object({
    workspacePath: z.string().trim().min(1).max(4096),
    state: workspaceTrustStateSchema,
  })
  .strict()
export type WorkspaceTrustSetBody = z.infer<typeof workspaceTrustSetSchema>
