import { describe, expect, it, vi } from "vitest"
import { normalizeLevel } from "../../permissions"
import {
  ASK_MODE_DENY_MESSAGE,
  PLAN_MODE_DENY_MESSAGE,
} from "../../shared/chat-mode-tools"
import { buildCanUseTool } from "./tool-approval-handler"

describe("buildCanUseTool", () => {
  it.each(["plan", "ask"])("keeps path denials active for read tools in %s mode", async (chatMode) => {
    const canUseTool = buildCanUseTool("protected-read", "bypass", vi.fn(), chatMode, {
      projectPermissionRules: [{ permission: "read", pattern: ".env", action: "deny" }],
    })
    await expect(canUseTool("Read", { file_path: ".env" })).resolves.toMatchObject({
      behavior: "deny",
      reason: "BetterC0de project permission denied read:.env.",
    })
  })

  it("does not turn a read-only denial into an approvable mutation through an ask rule", async () => {
    const emit = vi.fn()
    const canUseTool = buildCanUseTool("read-only-ask-rule", "read-only", emit, "agent", {
      projectPermissionRules: [{ permission: "edit", pattern: "*", action: "ask" }],
    })
    await expect(canUseTool("Write", { file_path: "a.txt" })).resolves.toMatchObject({ behavior: "deny" })
    expect(emit.mock.calls.some(([event]) => event.event_type === "tool_approval_requested")).toBe(false)
  })

  it("hard-denies mutating tools in plan mode regardless of permission level", async () => {
    const emit = vi.fn()
    const canUseTool = buildCanUseTool(
      "thread-plan",
      normalizeLevel("bypass"),
      emit,
      "plan"
    )

    expect(canUseTool).toBeTypeOf("function")
    await expect(
      canUseTool?.("Read", { file_path: "src/app.ts" })
    ).resolves.toEqual({
      behavior: "allow",
    })
    await expect(
      canUseTool?.("Bash", { command: "touch owned" })
    ).resolves.toEqual({
      behavior: "deny",
      reason: PLAN_MODE_DENY_MESSAGE,
    })
    expect(emit).toHaveBeenCalledWith({
      event_type: "content_delta",
      thread_id: "thread-plan",
      payload: { delta: `\n\n> ${PLAN_MODE_DENY_MESSAGE}\n\n` },
    })
  })

  it("keeps allow-edits inside the application policy gate", async () => {
    const canUseTool = buildCanUseTool(
      "thread-agent",
      normalizeLevel("allow-edits"),
      vi.fn(),
      "agent"
    )

    expect(canUseTool).toBeTypeOf("function")
    await expect(
      canUseTool?.("Edit", { file_path: "src/app.ts" })
    ).resolves.toEqual({ behavior: "allow" })
  })

  it("keeps project permission rules active even on the allow-edits fast path", async () => {
    const emit = vi.fn()
    const canUseTool = buildCanUseTool(
      "thread-project-policy",
      normalizeLevel("allow-edits"),
      emit,
      "agent",
      {
        projectPermissionRules: [
          { permission: "bash", pattern: "rm *", action: "deny" },
        ],
      }
    )

    expect(canUseTool).toBeTypeOf("function")
    await expect(
      canUseTool?.("Bash", { command: "rm -rf dist" })
    ).resolves.toEqual({
      behavior: "deny",
      reason: "BetterC0de project permission denied bash:rm -rf dist.",
    })
    expect(emit).toHaveBeenCalledWith({
      event_type: "content_delta",
      thread_id: "thread-project-policy",
      payload: {
        delta:
          "\n\n> BetterC0de project permission denied bash:rm -rf dist.\n\n",
      },
    })
  })

  it("does not let BetterC0de allow rules widen a read-only session", async () => {
    const canUseTool = buildCanUseTool(
      "thread-project-allow",
      normalizeLevel("read-only"),
      vi.fn(),
      "agent",
      {
        projectPermissionRules: [
          { permission: "bash", pattern: "npm test *", action: "allow" },
        ],
      }
    )

    await expect(
      canUseTool?.("Bash", { command: "npm test -- --runInBand" })
    ).resolves.toEqual({
      behavior: "deny",
      reason: expect.stringContaining("Read-Only mode"),
    })
  })

  it("hard-denies mutating tools in ask mode", async () => {
    const emit = vi.fn()
    const canUseTool = buildCanUseTool(
      "thread-ask",
      normalizeLevel("bypass"),
      emit,
      "ask"
    )

    await expect(canUseTool?.("Read", {})).resolves.toEqual({
      behavior: "allow",
    })
    await expect(canUseTool?.("Edit", {})).resolves.toEqual({
      behavior: "deny",
      reason: ASK_MODE_DENY_MESSAGE,
    })
  })

  it("keeps security mode approval-gated even when allow-edits is selected", async () => {
    const emit = vi.fn()
    const canUseTool = buildCanUseTool(
      "thread-security",
      normalizeLevel("allow-edits"),
      emit,
      "security"
    )

    expect(canUseTool).toBeTypeOf("function")
    await expect(canUseTool?.("Read", {})).resolves.toEqual({
      behavior: "allow",
    })
  })
})
