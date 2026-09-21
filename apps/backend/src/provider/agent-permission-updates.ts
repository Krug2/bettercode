import {
  permissionUpdateSchema,
  type PermissionUpdate,
} from "@betterc0de/schema"
import type { AgentPermissionPolicy } from "./agent-permission-policy"
import {
  normalizeAgentPermissionToolName,
  normalizeWorkspaceRelativePath,
} from "./agent-permission-policy"
import { recordSessionPermissionUpdates } from "./session-permission-rules"

type AgentPermissionGrantWriter = Pick<AgentPermissionPolicy, "upsertGrant">

export interface ApprovedPermissionUpdateResult {
  readonly durableGrantCount: number
  readonly sessionRuleUpdateCount: number
  readonly skippedRuleCount: number
}

/**
 * Mirrors approval-dialog "Always allow" updates into BetterC0de's shared
 * permission engine. Provider-native updates are still forwarded unchanged;
 * this mirror is what makes the choice effective for direct API and ACP
 * providers as well.
 *
 * A provider command/domain pattern cannot be represented safely by the
 * shared per-tool/per-path grant model. Those patterns stay provider-native
 * (and session patterns stay exact) instead of being widened to a tool-wide
 * durable grant.
 */
/**
 * Updates the Claude CLI is allowed to persist. `bypassPermissions` and
 * directory grants are not approval-card choices, and a mode change is only
 * kept for this session.
 */
export function permissionUpdatesForClaudeSdk(
  updates: readonly unknown[]
): unknown[] {
  return updates.filter((update) => {
    if (!update || typeof update !== "object") return false
    const record = update as {
      type?: unknown
      mode?: unknown
      destination?: unknown
    }
    if (record.type === "addDirectories" || record.type === "removeDirectories") {
      return false
    }
    if (record.type === "setMode") {
      return record.mode !== "bypassPermissions" && record.destination === "session"
    }
    return true
  })
}

export function recordApprovedPermissionUpdates(input: {
  readonly threadId: string
  readonly workspacePath?: string | null
  readonly updates: ReadonlyArray<unknown>
  readonly policy?: AgentPermissionGrantWriter | null
}): ApprovedPermissionUpdateResult {
  const parsedUpdates: PermissionUpdate[] = []
  for (const update of input.updates) {
    const parsed = permissionUpdateSchema.safeParse(update)
    if (parsed.success) parsedUpdates.push(parsed.data)
  }

  let durableGrantCount = 0
  let skippedRuleCount = 0
  const policy = input.policy
  if (policy) {
    for (const update of parsedUpdates) {
      if (
        update.type !== "addRules" ||
        update.behavior !== "allow" ||
        (update.destination !== "localSettings" &&
          update.destination !== "projectSettings" &&
          update.destination !== "userSettings")
      ) {
        continue
      }

      const destination =
        update.destination === "userSettings" ? "user" : "workspace"
      if (destination === "workspace" && !input.workspacePath?.trim()) {
        skippedRuleCount += update.rules.length
        continue
      }

      for (const rule of update.rules) {
        const pathScope = sharedGrantPathScope({
          workspacePath: input.workspacePath,
          toolName: rule.toolName,
          ruleContent: rule.ruleContent,
        })
        if (pathScope === null) {
          skippedRuleCount += 1
          continue
        }
        policy.upsertGrant({
          destination,
          ...(destination === "workspace"
            ? { workspacePath: input.workspacePath }
            : {}),
          toolName: rule.toolName,
          pathScope,
          behavior: "allow",
        })
        durableGrantCount += 1
      }
    }
  }

  const sessionUpdates = parsedUpdates.filter(
    (update) =>
      update.destination === "session" &&
      (update.type === "addRules" || update.type === "replaceRules" || update.type === "removeRules")
  )
  recordSessionPermissionUpdates(input.threadId, sessionUpdates)

  return {
    durableGrantCount,
    sessionRuleUpdateCount: sessionUpdates.reduce(
      (count, update) =>
        count + ("rules" in update ? update.rules.length : 0),
      0
    ),
    skippedRuleCount,
  }
}

function sharedGrantPathScope(input: {
  readonly workspacePath?: string | null
  readonly toolName: string
  readonly ruleContent?: string
}): string | null {
  const content = input.ruleContent?.trim()
  // An unscoped allow rule is never persisted as a durable grant.
  //
  // This used to return "." — the workspace root — which matches every path,
  // for a tool name that `normalizeAgentPermissionToolName` has already
  // collapsed into a family: `bash` covers shell/terminal/exec, and `edit`
  // covers Write/MultiEdit/NotebookEdit/apply_patch. So one "Always allow"
  // click on a single approved call persisted "any command, any path, forever"
  // — and at the `userSettings` destination, forever in *every* workspace.
  // `ProviderHub.applyDurableApprovalDecision` then auto-answers later
  // approvals from that grant, so no card is ever shown again.
  //
  // `session-permission-rules.ts` already refuses unscoped allows for exactly
  // this reason; the durable writer must agree. Returning null makes the caller
  // count it as skipped, which keeps a broad rule from silently doing more than
  // the approval dialog described.
  if (!content) return null

  const toolName = normalizeAgentPermissionToolName(input.toolName)
  if (!FILE_SCOPED_TOOLS.has(toolName) || !input.workspacePath?.trim()) {
    return null
  }

  // The shared policy supports directory/file prefixes, not arbitrary globs.
  // A trailing subtree glob is exactly representable after removing it.
  const candidate = content.replace(/(?:[\\/]\*\*?|[\\/])$/, "")
  if (!candidate || /[*?[\]{}]/.test(candidate)) return null
  try {
    return normalizeWorkspaceRelativePath(input.workspacePath, candidate)
  } catch {
    return null
  }
}

const FILE_SCOPED_TOOLS = new Set([
  "edit",
  "read",
  "list",
  "glob",
  "grep",
])
