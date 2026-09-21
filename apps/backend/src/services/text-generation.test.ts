import { describe, expect, it } from "vitest"
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  compactCommitPatch,
  buildPrContentPrompt,
  buildThreadContextSummaryPrompt,
  buildThreadTitlePrompt,
  extractJsonObject,
  limitSection,
  normalizeGeneratedBranchName,
  normalizeGeneratedCommitMessage,
  normalizeGeneratedPrContent,
  normalizeGeneratedThreadContextSummary,
  normalizeGeneratedThreadTitle,
  sanitizeBranchFragment,
  sanitizeCommitSubject,
  sanitizeFeatureBranchName,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./text-generation"

describe("text generation prompts", () => {
  it("builds BetterC0de commit prompts with staged summary and patch", () => {
    const result = buildCommitMessagePrompt({
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md\n+hello",
      includeBranch: false,
    })

    expect(result.prompt).toContain("Staged files:")
    expect(result.prompt).toContain("M README.md")
    expect(result.prompt).toContain("Staged patch:")
    expect(result.prompt).toContain("diff --git a/README.md b/README.md")
    expect(result.prompt).toContain("Branch: main")
    expect(result.prompt).not.toContain(
      "branch must be a short semantic git branch fragment"
    )
  })

  it("adds the branch key and instruction when commit generation requests a branch", () => {
    const result = buildCommitMessagePrompt({
      branch: "feature/foo",
      stagedSummary: "M README.md",
      stagedPatch: "diff",
      includeBranch: true,
    })

    expect(result.prompt).toContain(
      "Return a JSON object with keys: subject, body, branch."
    )
    expect(result.prompt).toContain(
      "branch must be a short semantic git branch fragment"
    )
  })

  it("builds BetterC0de PR prompts from branch, commits, stat, and patch", () => {
    const result = buildPrContentPrompt({
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: add login page",
      diffSummary: "3 files changed",
      diffPatch: "diff --git a/auth.ts b/auth.ts\n+export function login()",
    })

    expect(result.prompt).toContain("Base branch: main")
    expect(result.prompt).toContain("Head branch: feature/auth")
    expect(result.prompt).toContain("Commits:")
    expect(result.prompt).toContain("feat: add login page")
    expect(result.prompt).toContain("Diff stat:")
    expect(result.prompt).toContain("3 files changed")
    expect(result.prompt).toContain("Diff patch:")
    expect(result.prompt).toContain("export function login()")
  })

  it("includes attachment metadata for branch names and thread titles", () => {
    const attachment = {
      type: "image",
      id: "att-1",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 12345,
    }

    expect(
      buildBranchNamePrompt({
        message: "Fix the layout from screenshot",
        attachments: [attachment],
      }).prompt
    ).toContain("screenshot.png (image/png, 12345 bytes)")
    expect(
      buildThreadTitlePrompt({
        message: "Name this thread from screenshot",
        attachments: [attachment],
      }).prompt
    ).toContain("Attachment metadata:")
  })

  it("builds thread-context compaction prompts for Claude Terminal handoff", () => {
    const result = buildThreadContextSummaryPrompt({
      threadTitle: "Claude Terminal",
      projectPath: "/repo",
      transcript:
        "User asked for native Claude Terminal. Assistant changed PTY files.",
    })

    expect(result.schemaName).toBe("threadContextSummary")
    expect(result.prompt).toContain("fresh Claude Terminal session")
    expect(result.prompt).toContain("Thread title: Claude Terminal")
    expect(result.prompt).toContain("Workspace: /repo")
    expect(result.prompt).toContain("Assistant changed PTY files")
  })
})

describe("text generation sanitizers", () => {
  it("uses BetterC0de's sidebar-safe thread-title limit", () => {
    expect(
      sanitizeThreadTitle(
        '  "Reconnect failures after restart because the session state does not recover"  '
      )
    ).toBe("Reconnect failures after restart because the se...")
  })

  it("sanitizes commit subjects and PR titles", () => {
    expect(sanitizeCommitSubject("Fix login bug.\n\nbody")).toBe(
      "Fix login bug"
    )
    expect(sanitizeCommitSubject("")).toBe("Update project files")
    expect(sanitizePrTitle("\n")).toBe("Update project changes")
  })

  it("sanitizes branch fragments and BetterC0de feature branch names", () => {
    expect(sanitizeBranchFragment(' "Fix Login Timeout!!!" ')).toBe(
      "fix-login-timeout"
    )
    expect(sanitizeFeatureBranchName("fix login timeout")).toBe(
      "feature/fix-login-timeout"
    )
    expect(sanitizeFeatureBranchName("feature/fix-login")).toBe(
      "feature/fix-login"
    )
  })

  it("limits long prompt sections with a truncation marker", () => {
    expect(limitSection("abcdef", 3)).toBe("abc\n\n[truncated]")
  })
})

describe("text generation output normalization", () => {
  it("keeps escaped quotes and braces inside string tokens, including unfinished output", () => {
    const object = JSON.stringify({ value: 'quote " then } and \\', nested: { ok: true } })
    expect(extractJsonObject("prefix " + object + " ignored {}" )).toBe(object)
    expect(extractJsonObject('prefix {"value":"unfinished } {')).toBe('{"value":"unfinished } {')
  })

  it("extracts the first balanced JSON object", () => {
    expect(
      extractJsonObject(
        'prefix {"message":"literal } brace","nested":{"ok":true}} suffix {"bad":true}'
      )
    ).toBe('{"message":"literal } brace","nested":{"ok":true}}')
  })

  it("parses and sanitizes generated commit JSON", () => {
    expect(
      normalizeGeneratedCommitMessage(
        '{"subject":"Fix checkout flow.","body":"- Adds test","branch":"Checkout Flow"}',
        { includeBranch: true }
      )
    ).toEqual({
      subject: "Fix checkout flow",
      body: "- Adds test",
      branch: "feature/checkout-flow",
    })
  })

  it("reports unavailable generation instead of presenting a filename as a commit", () => {
    expect(() => normalizeGeneratedCommitMessage(null, { includeBranch: false })).toThrow("Check that your text-generation provider")
  })

  it.each([
    '{"subject":"- apps/shell/browser-preview-preload.cjs","body":""}',
    '{"subject":"Update files","body":""}',
    '{"subject":"Update files"',
    'not JSON',
  ])("rejects incomplete commit output: %s", raw => {
    expect(() => normalizeGeneratedCommitMessage(raw, { includeBranch: false })).toThrow("incomplete commit summary")
  })

  it("preserves a provider's plain-text subject and multiline summary", () => {
    expect(normalizeGeneratedCommitMessage("Fix preview selection\n\n- Keep selection aligned while scrolling\n- Preserve focus when closing details", { includeBranch: false })).toEqual({
      subject: "Fix preview selection", body: "- Keep selection aligned while scrolling\n- Preserve focus when closing details",
    })
  })

  it("includes later files when a large first diff exceeds the prompt budget", () => {
    const patch = "diff --git a/lockfile b/lockfile\n" + "+dependency\n".repeat(10_000) + "diff --git a/app.ts b/app.ts\n+fixSelection()\n"
    const compact = compactCommitPatch(patch)
    expect(compact.length).toBeLessThanOrEqual(60_000)
    expect(compact).toContain("a/lockfile")
    expect(compact).toContain("+fixSelection()")
    expect(compact).toContain("excerpt")
  })

  it("normalizes PR, branch, and thread title JSON", () => {
    expect(
      normalizeGeneratedPrContent(
        '{"title":"Add provider routing","body":"## Summary"}',
        {
          fallbackTitleSeed: "fallback",
        }
      )
    ).toEqual({ title: "Add provider routing", body: "## Summary" })
    expect(
      normalizeGeneratedBranchName(
        '```json\n{"branch":"Provider Routing"}\n```',
        {
          fallbackSeed: "fallback",
        }
      )
    ).toEqual({ branch: "provider-routing" })
    expect(
      normalizeGeneratedThreadTitle('{"title":"Provider routing fixes."}', {
        fallbackSeed: "fallback",
      })
    ).toEqual({ title: "Provider routing fixes." })
    expect(
      normalizeGeneratedThreadContextSummary(
        '{"summary":"Keep terminal state"}',
        {
          fallbackSummary: "fallback summary",
        }
      )
    ).toEqual({ summary: "Keep terminal state" })
  })

  it("normalizes generated JSON from surrounding markdown without swallowing later braces", () => {
    expect(
      normalizeGeneratedBranchName(
        'Sure:\n```json\n{"branch":"Provider } Routing"}\n```\nDone {"branch":"Wrong"}',
        { fallbackSeed: "fallback" }
      )
    ).toEqual({ branch: "provider-routing" })
  })
})
