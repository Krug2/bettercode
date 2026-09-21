import { describe, expect, it } from "vitest"
import {
  chatGenerateBranchNameSchema,
  chatGenerateCommitMessageSchema,
  chatGeneratePrContentSchema,
  chatGenerateThreadContextSummarySchema,
  chatSendSchema,
} from "./validation"
import { providerSendTurnInputSchema } from "@betterc0de/schema"

describe("chat send validation", () => {
  it("defaults omitted/null app mode to Agent and normalizes casing", () => {
    const base = {
      threadId: "thread-1",
      providerKind: "codex",
      message: "Build it",
      modelId: "gpt-5.5",
    }

    expect(chatSendSchema.parse(base).app_mode).toBe("agent")
    expect(chatSendSchema.parse({ ...base, appMode: null }).app_mode).toBe(
      "agent"
    )
    expect(
      chatSendSchema.parse({ ...base, appMode: "  DESIGN  " }).app_mode
    ).toBe("design")
  })

  it("accepts modelSelection while preserving legacy modelId fields", () => {
    const parsed = chatSendSchema.parse({
      threadId: "thread-1",
      providerKind: "codex",
      providerInstanceId: "codex-work",
      message: "Build it",
      modelId: "gpt-5.5",
      modelSelection: {
        instanceId: "codex-work",
        model: "gpt-5.5",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
    })

    expect(parsed.model_id).toBe("gpt-5.5")
    expect(parsed.provider_instance_id).toBe("codex-work")
    expect(parsed.model_selection).toEqual({
      instanceId: "codex-work",
      model: "gpt-5.5",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    })
  })

  it("derives model_id from modelSelection when legacy modelId is absent", () => {
    const parsed = chatSendSchema.parse({
      threadId: "thread-1",
      providerKind: "codex",
      message: "Build it",
      modelSelection: {
        instanceId: "codex-work",
        model: "gpt-5.5",
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      },
    })

    expect(parsed.model_id).toBe("gpt-5.5")
    expect(parsed.model_selection?.instanceId).toBe("codex-work")
  })

  it("rejects incomplete chat send commands before they reach providers", () => {
    expect(() =>
      chatSendSchema.parse({
        providerKind: "codex",
        message: "Build it",
        modelId: "gpt-5.5",
      })
    ).toThrow(/threadId is required/)
    expect(() =>
      chatSendSchema.parse({
        threadId: "thread-1",
        providerKind: "codex",
        message: " ",
        modelId: "gpt-5.5",
      })
    ).toThrow(/message is required/)
    expect(() =>
      chatSendSchema.parse({
        threadId: "thread-1",
        providerKind: "codex",
        message: "Build it",
      })
    ).toThrow(/modelId is required/)
  })

  it("keeps provider runtime send input compatible with modelSelection", () => {
    const parsed = providerSendTurnInputSchema.parse({
      threadId: "thread-1",
      message: "Build it",
      modelId: "gpt-5.5",
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.5",
        options: [{ id: "effort", value: "xhigh" }],
      },
    })

    expect(parsed.modelSelection?.options).toEqual([
      { id: "effort", value: "xhigh" },
    ])
  })

  it("accepts structured image attachments on chat sends", () => {
    const parsed = chatSendSchema.parse({
      threadId: "thread-1",
      providerKind: "BetterC0de",
      message: "What is in this image?",
      modelId: "anthropic/claude-sonnet-4-5",
      attachments: [
        {
          type: "file",
          filename: "screen.png",
          mediaType: "image/png",
          url: "data:image/png;base64,AAA",
        },
      ],
    })

    expect(parsed.attachments).toEqual([
      {
        type: "file",
        filename: "screen.png",
        mediaType: "image/png",
        url: "data:image/png;base64,AAA",
      },
    ])
  })

  it("accepts sourceProposedPlan references", () => {
    const parsed = chatSendSchema.parse({
      threadId: "thread-implementation",
      providerKind: "claude",
      message: "Implement the proposed plan.",
      modelId: "claude-opus-4-7",
      sourceProposedPlan: {
        threadId: "thread-plan",
        planId: "plan-1",
      },
    })

    expect(parsed.source_proposed_plan).toEqual({
      threadId: "thread-plan",
      planId: "plan-1",
    })

    const runtimeInput = providerSendTurnInputSchema.parse({
      threadId: "thread-implementation",
      message: "Implement the proposed plan.",
      modelId: "claude-opus-4-7",
      sourceProposedPlan: {
        thread_id: "thread-plan",
        plan_id: "plan-1",
      },
    })

    expect(runtimeInput.sourceProposedPlan).toEqual({
      threadId: "thread-plan",
      planId: "plan-1",
    })
  })

  it("accepts Canvas Mode context for provider turns", () => {
    const designContext = {
      target: "dashboard",
      colorMode: "dark",
      styleTemplateId: "dashboard-pro",
      customStyleReferences: {
        websiteLinks: [],
        imageFiles: [],
        htmlFiles: [],
        notes: "",
      },
      fontPresetId: "geist",
      customFont: "",
      componentImports: [],
      description: "Create an analytics workspace.",
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    }

    const parsed = chatSendSchema.parse({
      threadId: "thread-1",
      providerKind: "codex",
      message: "Design it",
      modelId: "gpt-5.5",
      appMode: "design",
      designContext,
    })

    expect(parsed.app_mode).toBe("design")
    expect(parsed.design_context?.target).toBe("dashboard")

    const runtimeInput = providerSendTurnInputSchema.parse({
      threadId: "thread-1",
      message: "Design it",
      modelId: "gpt-5.5",
      appMode: "design",
      designContext,
    })

    expect(runtimeInput.appMode).toBe("design")
    expect(runtimeInput.designContext?.description).toBe(
      "Create an analytics workspace."
    )
  })

  it("rejects incomplete provider runtime send inputs", () => {
    expect(() =>
      providerSendTurnInputSchema.parse({
        threadId: "",
        message: "Build it",
        modelId: "gpt-5.5",
      })
    ).toThrow(/threadId is required/)
    expect(() =>
      providerSendTurnInputSchema.parse({
        threadId: "thread-1",
        message: "",
        modelId: "gpt-5.5",
      })
    ).toThrow(/message is required/)
    expect(() =>
      providerSendTurnInputSchema.parse({
        threadId: "thread-1",
        message: "Build it",
        modelId: "",
      })
    ).toThrow(/modelId is required/)
  })

  it("accepts native Codex collaboration mode objects", () => {
    const parsed = chatSendSchema.parse({
      threadId: "thread-1",
      providerKind: "codex",
      message: "Plan it",
      modelId: "gpt-5.5",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "medium",
          developer_instructions:
            "<collaboration_mode>Plan</collaboration_mode>",
        },
      },
    })

    expect(parsed.collaborationMode).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: "medium",
        developer_instructions: "<collaboration_mode>Plan</collaboration_mode>",
      },
    })
  })
})

describe("chat text-generation validation", () => {
  it("accepts commit message generation inputs", () => {
    const parsed = chatGenerateCommitMessageSchema.parse({
      branch_name: "feature/foo",
      staged_summary: "M README.md",
      staged_patch: "diff --git a/README.md b/README.md",
      include_branch: true,
      policy: {
        kind: "conventional_commits",
        inferRepositoryConventions: false,
      },
      model_selection: {
        instanceId: "codex",
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    })

    expect(parsed).toEqual({
      cwd: null,
      branch: "feature/foo",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md",
      includeBranch: true,
      policy: {
        kind: "conventional_commits",
        inferRepositoryConventions: false,
      },
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    })
  })

  it("accepts PR content generation inputs", () => {
    const parsed = chatGeneratePrContentSchema.parse({
      base_branch: "main",
      head_branch: "feature/auth",
      commit_summary: "feat: auth",
      diff_summary: "2 files changed",
      diff_patch: "diff",
    })

    expect(parsed).toEqual({
      cwd: null,
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: auth",
      diffSummary: "2 files changed",
      diffPatch: "diff",
      policy: undefined,
      modelSelection: null,
    })
  })

  it("accepts branch generation inputs with attachment metadata", () => {
    const parsed = chatGenerateBranchNameSchema.parse({
      user_message: "Fix screenshot layout",
      attachment_metadata: [
        {
          type: "image",
          id: "att-1",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 42,
        },
      ],
    })

    expect(parsed).toEqual({
      cwd: null,
      message: "Fix screenshot layout",
      attachments: [
        {
          type: "image",
          id: "att-1",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 42,
        },
      ],
      policy: undefined,
      modelSelection: null,
    })
  })

  it("accepts thread context summary generation inputs", () => {
    const parsed = chatGenerateThreadContextSummarySchema.parse({
      cwd: "/repo",
      thread_title: "Claude Terminal",
      project_path: "/repo",
      transcript: "User: build terminal\nAssistant: implemented PTY",
      model_selection: {
        instanceId: "claude-terminal",
        model: "claude-opus-4-7",
        options: [{ id: "effort", value: "max" }],
      },
    })

    expect(parsed).toEqual({
      cwd: "/repo",
      threadTitle: "Claude Terminal",
      projectPath: "/repo",
      transcript: "User: build terminal\nAssistant: implemented PTY",
      modelSelection: {
        instanceId: "claude-terminal",
        model: "claude-opus-4-7",
        options: [{ id: "effort", value: "max" }],
      },
    })
  })
})
