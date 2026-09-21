import { describe, expect, it } from "vitest"
import {
  AGENT_APPROVAL_MODES,
  AGENT_SANDBOX_MODES,
  DEFAULT_AGENT_PERMISSION,
  LEGACY_PERMISSION_LEVELS,
  agentPermissionAllowsWrites,
  agentPermissionFromLegacyLevel,
  agentPermissionRequiresApproval,
  agentPermissionSchema,
  legacyLevelFromAgentPermission,
  type AgentPermission,
} from "@betterc0de/schema/agent-permission-modes"

function permission(overrides: Partial<AgentPermission> = {}): AgentPermission {
  return { ...DEFAULT_AGENT_PERMISSION, ...overrides }
}

describe("legacy mapping", () => {
  it("translates every old value", () => {
    for (const level of LEGACY_PERMISSION_LEVELS) {
      const mapped = agentPermissionFromLegacyLevel(level)
      expect(AGENT_APPROVAL_MODES, level).toContain(mapped.approval)
      expect(AGENT_SANDBOX_MODES, level).toContain(mapped.sandbox)
    }
  })

  it("keeps read-only meaning read-only", () => {
    expect(agentPermissionFromLegacyLevel("read-only").sandbox).toBe("read-only")
  })

  it("separates the two old 'everything is allowed' values", () => {
    // Both auto-approved, but only one had no guardrails at all. Collapsing
    // them would silently promote a workspace-scoped setting to unrestricted.
    expect(agentPermissionFromLegacyLevel("allow-edits")).toMatchObject({
      approval: "full-access",
      sandbox: "workspace-write",
    })
    expect(agentPermissionFromLegacyLevel("bypass")).toMatchObject({
      approval: "full-access",
      sandbox: "unrestricted",
    })
  })

  it("falls back to the cautious default for anything unrecognised", () => {
    // Never pass an unknown string through as if it were permission.
    for (const junk of ["", "  ", "yolo", "FULL-ACCESS", null, undefined]) {
      expect(agentPermissionFromLegacyLevel(junk), String(junk)).toEqual(
        DEFAULT_AGENT_PERMISSION
      )
    }
  })

  it("round-trips the old values that still have an exact equivalent", () => {
    for (const level of LEGACY_PERMISSION_LEVELS) {
      const back = legacyLevelFromAgentPermission(
        agentPermissionFromLegacyLevel(level)
      )
      expect(back, level).toBe(level)
    }
  })

  it("reports the stricter neighbour for a mode the old axis could not express", () => {
    expect(
      legacyLevelFromAgentPermission(permission({ approval: "auto-edits" }))
    ).toBe("ask-on-edit")
  })
})

describe("what the modes actually permit", () => {
  it("never asks before reading", () => {
    // Read-only exists so an agent can search and read freely; prompting for
    // every read would make it useless rather than safe.
    for (const approval of AGENT_APPROVAL_MODES) {
      for (const sandbox of AGENT_SANDBOX_MODES) {
        expect(
          agentPermissionRequiresApproval(
            permission({ approval, sandbox }),
            "read"
          ),
          `${approval}/${sandbox}`
        ).toBe(false)
      }
    }
  })

  it("blocks writes in read-only no matter how permissive approval is", () => {
    for (const approval of AGENT_APPROVAL_MODES) {
      const p = permission({ approval, sandbox: "read-only" })
      expect(agentPermissionAllowsWrites(p), approval).toBe(false)
      expect(agentPermissionRequiresApproval(p, "edit"), approval).toBe(true)
      expect(agentPermissionRequiresApproval(p, "command"), approval).toBe(true)
    }
  })

  it("lets auto-edits through for edits but still asks for commands", () => {
    const p = permission({ approval: "auto-edits" })
    expect(agentPermissionRequiresApproval(p, "edit")).toBe(false)
    expect(agentPermissionRequiresApproval(p, "command")).toBe(true)
  })

  it("asks for everything under supervision", () => {
    const p = permission({ approval: "supervised" })
    expect(agentPermissionRequiresApproval(p, "edit")).toBe(true)
    expect(agentPermissionRequiresApproval(p, "command")).toBe(true)
  })

  it("asks for nothing under full access", () => {
    const p = permission({ approval: "full-access" })
    expect(agentPermissionRequiresApproval(p, "edit")).toBe(false)
    expect(agentPermissionRequiresApproval(p, "command")).toBe(false)
  })
})

describe("schema", () => {
  it("fills in the cautious defaults", () => {
    expect(agentPermissionSchema.parse({})).toEqual(DEFAULT_AGENT_PERMISSION)
  })

  it("rejects a value outside the axis instead of coercing it", () => {
    // The old wire type was a bare string, so a typo silently became a
    // permission level. It must fail loudly now.
    expect(() => agentPermissionSchema.parse({ approval: "bypass" })).toThrow()
    expect(() =>
      agentPermissionSchema.parse({ sandbox: "danger-full-access" })
    ).toThrow()
  })

  it("keeps plan as its own axis, not a permission level", () => {
    const planned = agentPermissionSchema.parse({
      interaction: "plan",
      approval: "full-access",
    })
    // Planning while auto-approving is a legal combination; the old single
    // axis could not express it at all.
    expect(planned.interaction).toBe("plan")
    expect(planned.approval).toBe("full-access")
  })
})
