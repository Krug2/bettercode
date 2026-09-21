import { describe, expect, it } from "vitest"
import {
  evaluatePermission,
  normalizeGatePermissionLevel,
  normalizeLevel,
} from "./permissions"
import { isImagegenAutoAllowed } from "./shared/chat-mode-tools"
import {
  bindAgentPermissionRuntimeContext,
  clearAgentPermissionRuntimeContext,
  configuredAgentAllowMayAutoApprove,
} from "./agent-permission-runtime"

describe("permission aliases read and full", () => {
  it("maps read and full to the same gate outcomes as their canonical forms", () => {
    expect(normalizeLevel("read")).toBe("read-only")
    expect(normalizeLevel("full")).toBe("allow-edits")
    expect(normalizeGatePermissionLevel("read")).toBe("read-only")
    expect(normalizeGatePermissionLevel("full")).toBe("allow-edits")
    expect(normalizeGatePermissionLevel("full-access")).toBe("allow-edits")

    expect(evaluatePermission("read", "write")).toBe(
      evaluatePermission("read-only", "write")
    )
    expect(evaluatePermission("full", "write")).toBe(
      evaluatePermission("allow-edits", "write")
    )
    expect(isImagegenAutoAllowed("agent", "read")).toBe(
      isImagegenAutoAllowed("agent", "read-only")
    )
    expect(isImagegenAutoAllowed("agent", "full")).toBe(
      isImagegenAutoAllowed("agent", "allow-edits")
    )
  })

  it("treats read as read-only for durable allow auto-approve", () => {
    const token = bindAgentPermissionRuntimeContext({
      threadId: "alias-thread",
      permissionLevel: "read",
      chatMode: "agent",
    })
    try {
      expect(configuredAgentAllowMayAutoApprove("alias-thread")).toBe(false)
    } finally {
      clearAgentPermissionRuntimeContext("alias-thread", token)
    }
    const allowToken = bindAgentPermissionRuntimeContext({
      threadId: "alias-thread-full",
      permissionLevel: "full",
      chatMode: "agent",
    })
    try {
      expect(configuredAgentAllowMayAutoApprove("alias-thread-full")).toBe(true)
    } finally {
      clearAgentPermissionRuntimeContext("alias-thread-full", allowToken)
    }
  })
})
