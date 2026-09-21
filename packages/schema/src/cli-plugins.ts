import { z } from "zod"

/**
 * CLI plugins — plugins installed in the user's Claude Code CLI
 * (`~/.claude/plugins`) or Codex CLI (`codex plugin list`). Distinct from
 * BetterC0de's own provider-plugin system (`plugin:*` IPC namespace); these
 * are inventoried read-only from the CLIs, which remain the source of truth
 * and load them natively in their own sessions.
 */

export const cliPluginSourceSchema = z.enum(["claude", "codex"])
export type CliPluginSource = z.infer<typeof cliPluginSourceSchema>

export const cliPluginSkillComponentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  path: z.string().optional(),
})
export type CliPluginSkillComponent = z.infer<
  typeof cliPluginSkillComponentSchema
>

export const cliPluginNamedComponentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
})
export type CliPluginNamedComponent = z.infer<
  typeof cliPluginNamedComponentSchema
>

export const cliPluginMcpServerComponentSchema = z.object({
  name: z.string(),
  transport: z.string().optional(),
  command: z.string().optional(),
  url: z.string().optional(),
})
export type CliPluginMcpServerComponent = z.infer<
  typeof cliPluginMcpServerComponentSchema
>

export const cliPluginComponentsSchema = z.object({
  skills: z.array(cliPluginSkillComponentSchema).default([]),
  agents: z.array(cliPluginNamedComponentSchema).default([]),
  commands: z.array(cliPluginNamedComponentSchema).default([]),
  mcpServers: z.array(cliPluginMcpServerComponentSchema).default([]),
  hooks: z.array(z.string()).default([]),
})
export type CliPluginComponents = z.infer<typeof cliPluginComponentsSchema>

export const cliPluginInterfaceSchema = z.object({
  displayName: z.string().optional(),
  shortDescription: z.string().optional(),
  category: z.string().optional(),
  logoPath: z.string().optional(),
  brandColor: z.string().optional(),
})
export type CliPluginInterface = z.infer<typeof cliPluginInterfaceSchema>

export const cliPluginSchema = z.object({
  source: cliPluginSourceSchema,
  /** Canonical id `name@marketplace` (matches both CLIs' plugin ids). */
  id: z.string(),
  name: z.string(),
  marketplace: z.string(),
  /** May be the literal string "unknown" (Claude writes that for untagged installs). */
  version: z.string(),
  scope: z.enum(["user", "project"]).default("user"),
  enabled: z.boolean(),
  installPath: z.string(),
  description: z.string().optional(),
  homepage: z.string().optional(),
  interface: cliPluginInterfaceSchema.optional(),
  components: cliPluginComponentsSchema,
})
export type CliPlugin = z.infer<typeof cliPluginSchema>

export const cliPluginSourceInventorySchema = z.object({
  /** Whether the CLI binary (codex) or config dir (claude) was found. */
  cliDetected: z.boolean(),
  /** Set when enumeration degraded (spawn failure, parse error, ...). */
  error: z.string().optional(),
  plugins: z.array(cliPluginSchema),
})
export type CliPluginSourceInventory = z.infer<
  typeof cliPluginSourceInventorySchema
>

export const cliPluginInventorySchema = z.object({
  claude: cliPluginSourceInventorySchema,
  codex: cliPluginSourceInventorySchema,
  scannedAt: z.number(),
})
export type CliPluginInventory = z.infer<typeof cliPluginInventorySchema>
