import { describe, expect, it } from "vitest"
import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
  buildCodexCollaborationMode,
} from "./CodexDeveloperInstructions"

describe("buildCodexCollaborationMode", () => {
  it("builds BetterC0de plan collaboration settings", () => {
    expect(
      buildCodexCollaborationMode({
        chatMode: "plan",
        model: "gpt-5.5",
        effort: "high",
      })
    ).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: "high",
        developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
      },
    })
  })

  it("instructs plan mode to plan tasks without mutating files or code", () => {
    expect(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS).toContain(
      "You may explore and execute non-mutating actions that improve the plan"
    )
    expect(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS).toContain(
      "Editing or writing files"
    )
    expect(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS).toContain("<proposed_plan>")
    expect(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS).toContain(
      "request_user_input"
    )
  })

  it("builds default collaboration settings to leave plan mode", () => {
    expect(buildCodexCollaborationMode({ chatMode: "agent" })).toEqual({
      mode: "default",
      settings: {
        reasoning_effort: "medium",
        developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      },
    })
  })

  it("steers default mode toward native PNG generation for UI assets", () => {
    expect(CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS).toContain(
      "image generation"
    )
    expect(CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS).toContain("PNG")
    // Plan mode stays untouched — no asset generation while planning.
    expect(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS).not.toContain(
      "image generation"
    )
  })
})
