import { z } from "zod"

/**
 * How much freedom an agent has, expressed as three independent axes.
 *
 * We used to fold all of it into one `permissionLevel` string — untyped on the
 * wire, and mixing questions that are not the same question. "Read-only" is
 * about what the agent may *touch*; "ask me first" is about *approval*; "plan
 * first" is about *how it works*. Collapsing them meant you could not say
 * "plan a change, but only after asking me" without inventing a sixth value.
 *
 * Approval, filesystem reach and interaction mode remain independent so a
 * change to one setting cannot silently broaden another permission boundary.
 *
 * Legacy single-value payloads still decode — see `agentPermissionFromLegacyLevel`.
 */

// ── Axis 1: approval ────────────────────────────────────────────────────────
/** When the agent must stop and ask. */
export const AGENT_APPROVAL_MODES = [
  /** Ask before any command or file change. The cautious default. */
  "supervised",
  /** Edits land on their own; commands and everything else still ask. */
  "auto-edits",
  /** Routine actions go through where the provider can judge them; the rest ask. */
  "auto",
  /** Nothing asks. */
  "full-access",
] as const

export type AgentApprovalMode = (typeof AGENT_APPROVAL_MODES)[number]
export const agentApprovalModeSchema = z.enum(AGENT_APPROVAL_MODES)
export const DEFAULT_AGENT_APPROVAL_MODE: AgentApprovalMode = "supervised"

// ── Axis 2: reach ───────────────────────────────────────────────────────────
/**
 * What the agent may touch, independent of who approves it. This is the axis
 * that survives a careless approval setting, so it is the one the backend
 * enforces rather than trusting a provider's own sandbox flag — several of
 * those are a silent no-op on Windows.
 */
export const AGENT_SANDBOX_MODES = [
  /** Read and search freely; never modify. Tool calls that only look are fine. */
  "read-only",
  /** Modify inside the workspace; nothing outside it. */
  "workspace-write",
  /** No boundary. Only reachable through an explicit, confirmed opt-in. */
  "unrestricted",
] as const

export type AgentSandboxMode = (typeof AGENT_SANDBOX_MODES)[number]
export const agentSandboxModeSchema = z.enum(AGENT_SANDBOX_MODES)
export const DEFAULT_AGENT_SANDBOX_MODE: AgentSandboxMode = "workspace-write"

// ── Axis 3: interaction ─────────────────────────────────────────────────────
/** How the agent works a turn. Orthogonal to both axes above. */
export const AGENT_INTERACTION_MODES = ["default", "plan"] as const

export type AgentInteractionMode = (typeof AGENT_INTERACTION_MODES)[number]
export const agentInteractionModeSchema = z.enum(AGENT_INTERACTION_MODES)
export const DEFAULT_AGENT_INTERACTION_MODE: AgentInteractionMode = "default"

// ── The triple ──────────────────────────────────────────────────────────────

export const agentPermissionSchema = z.object({
  approval: agentApprovalModeSchema.default(DEFAULT_AGENT_APPROVAL_MODE),
  sandbox: agentSandboxModeSchema.default(DEFAULT_AGENT_SANDBOX_MODE),
  interaction: agentInteractionModeSchema.default(DEFAULT_AGENT_INTERACTION_MODE),
})

export type AgentPermission = z.infer<typeof agentPermissionSchema>

export const DEFAULT_AGENT_PERMISSION: AgentPermission = {
  approval: DEFAULT_AGENT_APPROVAL_MODE,
  sandbox: DEFAULT_AGENT_SANDBOX_MODE,
  interaction: DEFAULT_AGENT_INTERACTION_MODE,
}

// ── Legacy ──────────────────────────────────────────────────────────────────

/**
 * The five values the old single-axis picker could produce. Persisted threads
 * and stored preferences still carry these, so they have to keep decoding.
 */
export const LEGACY_PERMISSION_LEVELS = [
  "read-only",
  "ask-on-edit",
  "default",
  "allow-edits",
  "bypass",
] as const

export type LegacyPermissionLevel = (typeof LEGACY_PERMISSION_LEVELS)[number]

/**
 * Translate one old value into the triple.
 *
 * Where the old value was ambiguous the mapping errs toward asking, never
 * toward acting: an unrecognised string becomes the cautious default rather
 * than being passed through.
 */
export function agentPermissionFromLegacyLevel(
  level: string | null | undefined
): AgentPermission {
  switch (level?.trim()) {
    case "read-only":
      return {
        approval: "supervised",
        sandbox: "read-only",
        interaction: "default",
      }
    case "ask-on-edit":
      return {
        approval: "supervised",
        sandbox: "workspace-write",
        interaction: "default",
      }
    case "default":
      // "the provider decides per its own rules" is exactly the `auto` axis.
      return {
        approval: "auto",
        sandbox: "workspace-write",
        interaction: "default",
      }
    case "allow-edits":
      // Was labelled "Full Access", but kept the provider's own guardrails —
      // so it is full-access approval inside the workspace, not unrestricted.
      return {
        approval: "full-access",
        sandbox: "workspace-write",
        interaction: "default",
      }
    case "bypass":
      return {
        approval: "full-access",
        sandbox: "unrestricted",
        interaction: "default",
      }
    default:
      return DEFAULT_AGENT_PERMISSION
  }
}

/**
 * The nearest old value for a triple, for the parts of the stack that still
 * speak one string. Lossy on purpose: `auto-edits` has no old equivalent and
 * reports as the stricter neighbour rather than inventing permission.
 */
export function legacyLevelFromAgentPermission(
  permission: AgentPermission
): LegacyPermissionLevel {
  if (permission.sandbox === "read-only") return "read-only"
  if (permission.approval === "full-access") {
    return permission.sandbox === "unrestricted" ? "bypass" : "allow-edits"
  }
  if (permission.approval === "auto") return "default"
  return "ask-on-edit"
}

/** Whether this configuration may modify anything at all. */
export function agentPermissionAllowsWrites(
  permission: AgentPermission
): boolean {
  return permission.sandbox !== "read-only"
}

/** Whether an action of this kind needs the user to say yes first. */
export function agentPermissionRequiresApproval(
  permission: AgentPermission,
  kind: "read" | "edit" | "command"
): boolean {
  // Reading never needs approval — that is what makes read-only useful rather
  // than merely safe.
  if (kind === "read") return false
  if (!agentPermissionAllowsWrites(permission)) {
    // Nothing that writes is reachable here, so there is nothing to approve.
    return true
  }
  switch (permission.approval) {
    case "full-access":
      return false
    case "auto":
      // The provider judges routine work; anything it does not auto-approve
      // still surfaces as a request.
      return false
    case "auto-edits":
      return kind !== "edit"
    case "supervised":
      return true
  }
}
