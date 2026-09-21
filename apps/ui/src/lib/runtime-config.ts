import { ipcApi } from "@/services/ipc-facade"
import { dispatchProviderMetadataChanged } from "@/lib/provider-metadata-events"
import { getSettings, updateSettings } from "@/services/backend/coreApi"

export interface RuntimeMcpServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  headers?: Record<string, string>
  headerEnv?: Record<string, string>
  envKeys?: string[]
  headerKeys?: string[]
  enabled: boolean
  installedAt?: string
  type?: string
  url?: string | null
  authenticated?: boolean
  sourcePath?: string
  timeoutMs?: number
  oauth?: "auto" | "disabled" | "configured"
  oauthKeys?: string[]
  authStatus?: "authenticated" | "expired" | "not_authenticated"
  authStorageKeys?: string[]
  authSourcePath?: string
  authServerUrl?: string | null
}

export interface RuntimeSkill {
  id: string
  name: string
  version: string
  public: boolean
  enabled: boolean
  description?: string
  content: string
  createdAt?: string
  updatedAt?: string
  source?: string
  sourceUrl?: string
  sourcePath?: string
  providerKinds?: string[]
  providerInstanceIds?: string[]
}

export interface RuntimeHook {
  id: string
  event:
    | "on_message_send"
    | "on_response_complete"
    | "on_file_change"
    | "on_commit"
  command: string
  enabled: boolean
  createdAt?: string
  updatedAt?: string
  lastRunAt?: string | null
  lastStatus?: "idle" | "running" | "success" | "error"
  lastExitCode?: number | null
  lastError?: string | null
}

export interface RuntimeSubagent {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
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
  permissions?: Array<{
    permission: string
    pattern: string
    action: "ask" | "allow" | "deny"
    sourcePath: string
  }>
  createdAt?: string
  updatedAt?: string
  source?: string
  sourcePath?: string
}

function normalizeNativeSkillProviderKind(
  value: string | null | undefined
): string | null {
  const key = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
  if (["codex", "codex-cli", "openai-cli"].includes(key)) return "codex"
  if (["claude", "claude-cli", "anthropic-cli"].includes(key)) return "claude"
  return null
}

function notifyNativeSkillMetadataChanged(
  skill: Pick<RuntimeSkill, "providerKinds" | "providerInstanceIds">
): void {
  const instanceIds = Array.from(
    new Set(
      (skill.providerInstanceIds ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  )
  for (const providerInstanceId of instanceIds) {
    dispatchProviderMetadataChanged({
      providerInstanceId,
      metadataKind: "skills",
    })
  }

  const providerKinds = Array.from(
    new Set(
      (skill.providerKinds ?? [])
        .map(normalizeNativeSkillProviderKind)
        .filter((entry): entry is string => Boolean(entry))
    )
  )
  for (const providerKind of providerKinds) {
    dispatchProviderMetadataChanged({
      providerKind,
      metadataKind: "skills",
    })
  }
}

function api() {
  return window.electronAPI
}

function ensureString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function ensureRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => [
      key,
      typeof raw === "string" ? raw : String(raw ?? ""),
    ])
  )
}

function extractDescriptionFromMarkdown(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") && !line.startsWith(">"))
  return lines[0] || ""
}

export async function getCustomRules(): Promise<string> {
  let backendAvailable = false
  try {
    const settings = await getSettings()
    backendAvailable = true
    const configured = ensureString(settings.custom_rules)
    if (configured.trim()) return configured
  } catch {
    // Fall through to the desktop compatibility file during backend startup.
  }

  try {
    const legacy = ensureString((await api()?.rulesGet?.())?.content)
    if (legacy.trim() && backendAvailable) {
      await updateSettings({ custom_rules: legacy }).catch(() => undefined)
    }
    return legacy
  } catch {
    return ""
  }
}

export async function saveCustomRules(content: string): Promise<void> {
  await updateSettings({ custom_rules: content })
  // Keep the historical desktop rules.md mirror in sync while packaged
  // clients migrate. The backend setting remains authoritative and remote
  // clients do not require Electron IPC.
  if (api()?.rulesSave) {
    await ipcApi.rules.save(content)
  }
}

export async function listRuntimeHooks(): Promise<RuntimeHook[]> {
  try {
    const hooks = (await api()?.hookList?.()) || []
    return Array.isArray(hooks)
      ? (hooks as Record<string, unknown>[]).map((hook) => ({
          id: ensureString(hook.id),
          event: (hook.event as RuntimeHook["event"]) || "on_message_send",
          command: ensureString(hook.command),
          enabled: hook.enabled !== false,
          createdAt: ensureString(hook.createdAt),
          updatedAt: ensureString(hook.updatedAt),
          lastRunAt: typeof hook.lastRunAt === "string" ? hook.lastRunAt : null,
          lastStatus:
            hook.lastStatus === "running" ||
            hook.lastStatus === "success" ||
            hook.lastStatus === "error"
              ? hook.lastStatus
              : "idle",
          lastExitCode:
            typeof hook.lastExitCode === "number" ? hook.lastExitCode : null,
          lastError: typeof hook.lastError === "string" ? hook.lastError : null,
        }))
      : []
  } catch {
    return []
  }
}

export async function saveRuntimeHook(
  hook: Partial<RuntimeHook>
): Promise<string> {
  const { id } = await ipcApi.hook.save(hook)
  return id
}

export async function deleteRuntimeHook(id: string): Promise<void> {
  await ipcApi.hook.delete(id)
}

export async function updateRuntimeHookRun(
  id: string,
  status: RuntimeHook["lastStatus"],
  exitCode?: number | null,
  error?: string | null
): Promise<void> {
  // updateRun's envelope is `{ok:true}` only — no payload — so no return
  // value to surface. Swallows errors for consistency with the prior
  // fire-and-forget behaviour; the run-status update is best-effort.
  try {
    await ipcApi.hook.updateRun(
      id,
      status ?? "idle",
      exitCode ?? null,
      error ?? null
    )
  } catch {
    /* intentional: run-status is telemetry, not correctness-critical */
  }
}

export async function listRuntimeMcps(): Promise<RuntimeMcpServer[]> {
  try {
    const mcps = (await api()?.mcpList?.()) || []
    return Array.isArray(mcps)
      ? (mcps as Record<string, unknown>[]).map((item) => ({
          id: ensureString(item.id),
          name: ensureString(item.name),
          command: ensureString(item.command),
          args: Array.isArray(item.args)
            ? item.args.filter(
                (value): value is string => typeof value === "string"
              )
            : [],
          env: ensureRecord(item.env),
          headers: ensureRecord(item.headers),
          headerEnv: ensureRecord(item.headerEnv),
          enabled: item.enabled !== false,
          installedAt: ensureString(item.installedAt),
          type: ensureString(item.type),
          url: typeof item.url === "string" ? item.url : null,
          authenticated: !!item.authenticated,
        }))
      : []
  } catch {
    return []
  }
}

export async function saveRuntimeMcp(
  server: Partial<RuntimeMcpServer>
): Promise<string> {
  const { id } = await ipcApi.mcp.install(server)
  return id
}

export async function deleteRuntimeMcp(id: string): Promise<void> {
  await ipcApi.mcp.remove(id)
}

export async function setRuntimeMcpEnabled(
  id: string,
  enabled: boolean
): Promise<void> {
  await ipcApi.mcp.setEnabled(id, enabled)
}

export async function probeRuntimeMcp(
  server: Partial<RuntimeMcpServer>
): Promise<{
  ok: boolean
  error?: string
  stdout?: string
  stderr?: string
  note?: string
}> {
  // Probe's envelope is non-standard (carries stdout/stderr on both
  // success and failure). ipcApi.mcp.probe preserves the raw shape but
  // throws on the `{ok:false}` error path; here we swallow to keep the
  // prior contract where callers pattern-match on the result envelope.
  try {
    const result = (await ipcApi.mcp.probe(server)) as
      | {
          ok: boolean
          error?: string
          stdout?: string
          stderr?: string
          note?: string
        }
      | null
      | undefined
    return result || { ok: false, error: "Probe unavailable" }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Probe unavailable",
    }
  }
}

export async function listRuntimeSkills(): Promise<RuntimeSkill[]> {
  try {
    const skills = (await api()?.skillList?.()) || []
    return Array.isArray(skills)
      ? (skills as Record<string, unknown>[]).map((skill) => {
          const content = ensureString(skill.content)
          return {
            id: ensureString(skill.id),
            name: ensureString(skill.name),
            version: ensureString(skill.version, "1.0.0"),
            public: !!skill.public,
            enabled: skill.enabled !== false,
            description:
              ensureString(skill.description) ||
              extractDescriptionFromMarkdown(content),
            content,
            createdAt: ensureString(skill.createdAt),
            updatedAt: ensureString(skill.updatedAt),
            source: ensureString(skill.source),
            sourceUrl: ensureString(skill.sourceUrl),
            sourcePath: ensureString(skill.sourcePath),
            providerKinds: Array.isArray(skill.providerKinds)
              ? skill.providerKinds.filter(
                  (entry): entry is string => typeof entry === "string"
                )
              : [],
            providerInstanceIds: Array.isArray(skill.providerInstanceIds)
              ? skill.providerInstanceIds.filter(
                  (entry): entry is string => typeof entry === "string"
                )
              : [],
          }
        })
      : []
  } catch {
    return []
  }
}

export async function saveRuntimeSkill(skill: {
  id?: string
  name: string
  version?: string
  isPublic?: boolean
  public?: boolean
  enabled?: boolean
  description?: string
  content: string
  source?: string
  sourceUrl?: string
  sourcePath?: string
  providerKinds?: string[]
  providerInstanceIds?: string[]
}): Promise<string> {
  const { id } = await ipcApi.skill.save(skill)
  notifyNativeSkillMetadataChanged(skill)
  return id
}

export async function deleteRuntimeSkill(id: string): Promise<void> {
  const existing = (await listRuntimeSkills()).find((skill) => skill.id === id)
  await ipcApi.skill.delete(id)
  if (existing) notifyNativeSkillMetadataChanged(existing)
}

export async function listRuntimeSubagents(): Promise<RuntimeSubagent[]> {
  try {
    const agents = (await api()?.subagentList?.()) || []
    return Array.isArray(agents)
      ? (agents as Record<string, unknown>[]).map((agent) => ({
          id: ensureString(agent.id),
          name: ensureString(agent.name),
          description: ensureString(agent.description),
          prompt: ensureString(agent.prompt),
          enabled: agent.enabled !== false,
          createdAt: ensureString(agent.createdAt),
          updatedAt: ensureString(agent.updatedAt),
          source: ensureString(agent.source),
          sourcePath: ensureString(agent.sourcePath),
        }))
      : []
  } catch {
    return []
  }
}

export async function saveRuntimeSubagent(agent: {
  id?: string
  name: string
  description?: string
  prompt: string
  enabled?: boolean
  source?: string
  sourcePath?: string
}): Promise<string> {
  const { id } = await ipcApi.subagent.save(agent)
  return id
}

export async function deleteRuntimeSubagent(id: string): Promise<void> {
  await ipcApi.subagent.delete(id)
}

export async function getRuntimePromptContext() {
  const [customRules, skills, mcps, subagents] = await Promise.all([
    getCustomRules(),
    listRuntimeSkills(),
    listRuntimeMcps(),
    listRuntimeSubagents(),
  ])

  return {
    customRules,
    skills: skills.filter((skill) => skill.enabled !== false),
    mcps: mcps.filter((mcp) => mcp.enabled !== false),
    subagents: subagents.filter((subagent) => subagent.enabled !== false),
  }
}
