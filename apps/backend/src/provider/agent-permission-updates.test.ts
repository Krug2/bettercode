import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentPermissionPolicy } from "./agent-permission-policy"
import { recordApprovedPermissionUpdates } from "./agent-permission-updates"
import {
  clearSessionRules,
  evaluateSessionRules,
} from "./session-permission-rules"

const WORKSPACE = "C:\\work\\project"

afterEach(() => {
  clearSessionRules("thread-1")
})

describe("recordApprovedPermissionUpdates", () => {
  it("persists scoped project grants through the shared policy", () => {
    const upsertGrant = vi.fn()
    const policy = {
      upsertGrant,
    } as unknown as Pick<AgentPermissionPolicy, "upsertGrant">

    const result = recordApprovedPermissionUpdates({
      threadId: "thread-1",
      workspacePath: WORKSPACE,
      policy,
      updates: [
        {
          type: "addRules",
          behavior: "allow",
          destination: "localSettings",
          rules: [{ toolName: "Edit", ruleContent: "src/**" }],
        },
      ],
    })

    expect(upsertGrant).toHaveBeenCalledTimes(1)
    expect(upsertGrant).toHaveBeenNthCalledWith(1, {
      destination: "workspace",
      workspacePath: WORKSPACE,
      toolName: "Edit",
      pathScope: "src",
      behavior: "allow",
    })
    expect(result).toEqual({
      durableGrantCount: 1,
      sessionRuleUpdateCount: 0,
      skippedRuleCount: 0,
    })
  })

  // Regression: an allow rule with no `ruleContent` used to be persisted with
  // `pathScope: "."` — the whole workspace — for a tool name that had already
  // been collapsed into a family (`exec_command_approval` normalizes to
  // `bash`, which also covers shell/terminal/exec). At the `userSettings`
  // destination that meant unattended shell in EVERY workspace, forever, from
  // a single "Always allow" click, auto-answered thereafter by
  // ProviderHub.applyDurableApprovalDecision with no approval card shown.
  it("refuses to persist an unscoped allow rule as a durable grant", () => {
    const upsertGrant = vi.fn()

    const result = recordApprovedPermissionUpdates({
      threadId: "thread-1",
      workspacePath: WORKSPACE,
      policy: {
        upsertGrant,
      } as unknown as Pick<AgentPermissionPolicy, "upsertGrant">,
      updates: [
        {
          type: "addRules",
          behavior: "allow",
          destination: "userSettings",
          rules: [{ toolName: "exec_command_approval" }],
        },
        {
          type: "addRules",
          behavior: "allow",
          destination: "localSettings",
          rules: [{ toolName: "Edit" }],
        },
      ],
    })

    expect(upsertGrant).not.toHaveBeenCalled()
    expect(result).toEqual({
      durableGrantCount: 0,
      sessionRuleUpdateCount: 0,
      skippedRuleCount: 2,
    })
  })

  it("keeps command patterns exact instead of widening durable grants", () => {
    const upsertGrant = vi.fn()
    const result = recordApprovedPermissionUpdates({
      threadId: "thread-1",
      workspacePath: WORKSPACE,
      policy: {
        upsertGrant,
      } as unknown as Pick<AgentPermissionPolicy, "upsertGrant">,
      updates: [
        {
          type: "addRules",
          behavior: "allow",
          destination: "localSettings",
          rules: [{ toolName: "Bash", ruleContent: "npm:*" }],
        },
      ],
    })

    expect(upsertGrant).not.toHaveBeenCalled()
    expect(result.skippedRuleCount).toBe(1)
  })

  it("applies session patterns to equivalent provider tool names", () => {
    const result = recordApprovedPermissionUpdates({
      threadId: "thread-1",
      workspacePath: WORKSPACE,
      updates: [
        {
          type: "addRules",
          behavior: "allow",
          destination: "session",
          rules: [{ toolName: "Bash", ruleContent: "npm:*" }],
        },
      ],
    })

    expect(result.sessionRuleUpdateCount).toBe(1)
    expect(
      evaluateSessionRules("thread-1", "shell", {
        command: "npm run test",
      })
    ).toBe("allow")
    expect(
      evaluateSessionRules("thread-1", "shell", {
        command: "git status",
      })
    ).toBeNull()
  })
})
