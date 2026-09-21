import { describe, expect, it } from "vitest"
import {
  appendBetterC0deAssistantTextDelta,
  buildBetterC0dePermissionRules,
  buildBetterC0deSessionPermissionRules,
  mergeBetterC0deAssistantText,
  betterC0deQuestionId,
  parseBetterC0deModelSlug,
  toBetterC0dePermissionReply,
  toBetterC0deQuestionAnswers,
} from "./BetterC0deCompatRuntimeSupport"

describe("parseBetterC0deModelSlug", () => {
  it("splits provider/model slugs", () => {
    expect(parseBetterC0deModelSlug("openai/gpt-5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
  })

  it("rejects incomplete slugs", () => {
    expect(parseBetterC0deModelSlug("gpt-5")).toBeNull()
    expect(parseBetterC0deModelSlug("openai/")).toBeNull()
    expect(parseBetterC0deModelSlug("/gpt-5")).toBeNull()
  })
})

describe("BetterC0de permissions", () => {
  it("allows all permissions in full-access mode", () => {
    expect(buildBetterC0dePermissionRules("full-access")).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
    ])
  })

  it("denies mutating tools in read-only mode while allowing questions", () => {
    expect(buildBetterC0dePermissionRules("read-only")).toContainEqual({
      permission: "edit",
      pattern: "*",
      action: "deny",
    })
    expect(buildBetterC0dePermissionRules("read-only")).toContainEqual({
      permission: "question",
      pattern: "*",
      action: "allow",
    })
  })

  it("keeps BetterC0de plan mode as a hard no-edit/no-shell mode", () => {
    expect(buildBetterC0dePermissionRules("plan")).toEqual(
      expect.arrayContaining([
        { permission: "plan_exit", pattern: "*", action: "allow" },
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "task", pattern: "*", action: "deny" },
      ])
    )
  })

  it("keeps BetterC0de security mode read-first and approval-gated", () => {
    expect(buildBetterC0dePermissionRules("security")).toEqual(
      expect.arrayContaining([
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "edit", pattern: "*", action: "ask" },
        { permission: "bash", pattern: "*", action: "ask" },
        { permission: "task", pattern: "*", action: "deny" },
      ])
    )
  })

  it("merges BetterC0de project tool and permission rules into session permissions", () => {
    expect(
      buildBetterC0deSessionPermissionRules({
        runtimeMode: "allow-edits",
        projectToolFlags: [{ tool: "webfetch", enabled: false }],
        projectPermissionRules: [
          { permission: "bash", pattern: "npm test *", action: "allow" },
          { permission: "edit", pattern: "src/generated/*", action: "deny" },
        ],
      })
    ).toEqual(
      expect.arrayContaining([
        { permission: "webfetch", pattern: "*", action: "deny" },
        { permission: "bash", pattern: "npm test *", action: "ask" },
        { permission: "edit", pattern: "src/generated/*", action: "deny" },
      ])
    )
  })

  it("normalizes legacy BetterC0de tool flags before merging permission rules", () => {
    const rules = buildBetterC0deSessionPermissionRules({
      runtimeMode: "allow-edits",
      projectToolFlags: [
        { tool: "write", enabled: false },
        { tool: "patch", enabled: false },
        { tool: "repo_overview", enabled: true, kind: "custom" },
      ],
      projectPermissionRules: [
        { permission: "edit", pattern: "*", action: "ask" },
      ],
    })

    const projectEditRules = rules.filter(
      (rule) => rule.permission === "edit" && rule.pattern === "*"
    )
    expect(projectEditRules.at(-1)).toEqual({
      permission: "edit",
      pattern: "*",
      action: "ask",
    })
    expect(rules).not.toContainEqual({
      permission: "write",
      pattern: "*",
      action: "deny",
    })
    expect(rules).not.toContainEqual({
      permission: "patch",
      pattern: "*",
      action: "deny",
    })
    expect(rules).not.toContainEqual({
      permission: "repo_overview",
      pattern: "*",
      action: "allow",
    })
  })

  it("keeps restrictive modes hard-denied after project allow rules", () => {
    const rules = buildBetterC0deSessionPermissionRules({
      runtimeMode: "plan",
      projectPermissionRules: [
        { permission: "bash", pattern: "*", action: "allow" },
      ],
    })

    expect(
      rules
        .filter(
          (rule) => rule.permission === "bash" && rule.pattern === "*"
        )
        .at(-1)
    ).toEqual({
      permission: "bash",
      pattern: "*",
      action: "deny",
    })
  })

  it("does not let project rules exceed security or allow-edits ceilings", () => {
    const security = buildBetterC0deSessionPermissionRules({
      runtimeMode: "security",
      projectPermissionRules: [
        { permission: "bash", pattern: "*", action: "allow" },
        { permission: "edit", pattern: "src/**", action: "allow" },
        { permission: "task", pattern: "*", action: "allow" },
      ],
    })
    expect(security).toEqual(
      expect.arrayContaining([
        { permission: "bash", pattern: "*", action: "ask" },
        { permission: "edit", pattern: "src/**", action: "ask" },
        { permission: "task", pattern: "*", action: "deny" },
      ])
    )

    const allowEdits = buildBetterC0deSessionPermissionRules({
      runtimeMode: "allow-edits",
      projectPermissionRules: [
        { permission: "edit", pattern: "src/**", action: "allow" },
        { permission: "bash", pattern: "npm test *", action: "allow" },
        { permission: "*", pattern: "*", action: "allow" },
      ],
    })
    expect(allowEdits).toContainEqual({
      permission: "edit",
      pattern: "src/**",
      action: "allow",
    })
    expect(allowEdits).toContainEqual({
      permission: "bash",
      pattern: "npm test *",
      action: "ask",
    })
    expect(allowEdits).not.toContainEqual({
      permission: "*",
      pattern: "*",
      action: "allow",
    })
  })

  it("maps BetterC0de approval decisions to BetterC0de replies", () => {
    expect(
      toBetterC0dePermissionReply({
        kind: "tool_approval",
        decision: "approve",
      })
    ).toBe("once")
    expect(
      toBetterC0dePermissionReply({ kind: "tool_approval", decision: "deny" })
    ).toBe("reject")
    expect(toBetterC0dePermissionReply({ kind: "user_input", answers: {} })).toBe(
      "reject"
    )
  })
})

describe("BetterC0de questions", () => {
  const request = {
    questions: [
      { header: "Pick Mode", question: "Which mode?" },
      { header: "", question: "Fallback question?" },
    ],
  }

  it("builds stable question ids", () => {
    expect(betterC0deQuestionId(0, request.questions[0])).toBe(
      "question-0-pick-mode"
    )
    expect(betterC0deQuestionId(1, request.questions[1])).toBe("question-1")
  })

  it("maps answer records by id, header, or question text", () => {
    expect(
      toBetterC0deQuestionAnswers(request, {
        "question-0-pick-mode": "plan",
        "Fallback question?": ["yes", "later", 1],
      })
    ).toEqual([["plan"], ["yes", "later"]])
  })
})

describe("BetterC0de assistant text deltas", () => {
  it("emits only the new suffix for absolute text updates", () => {
    expect(mergeBetterC0deAssistantText("hello", "hello world")).toEqual({
      latestText: "hello world",
      deltaToEmit: " world",
    })
  })

  it("keeps the longer previous text if a late shorter update arrives", () => {
    expect(mergeBetterC0deAssistantText("hello world", "hello")).toEqual({
      latestText: "hello world",
      deltaToEmit: "",
    })
  })

  it("appends streaming deltas directly", () => {
    expect(appendBetterC0deAssistantTextDelta("hello", " world")).toEqual({
      nextText: "hello world",
      deltaToEmit: " world",
    })
  })
})
