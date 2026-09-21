import { describe, expect, it } from "vitest"
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  resolvePlanFollowUpSubmission,
  shouldCollapseProposedPlan,
  stripDisplayedPlanMarkdown,
} from "@/lib/proposed-plan"

describe("proposed plan handoff", () => {
  it("preserves body indentation and blank lines while counting visible preview rows", () => {
    const markdown = "# Plan\r\n\r\n## Summary\r\n    code  \r\n\r\nnext\r\nlast"
    expect(buildCollapsedProposedPlanPreviewMarkdown(markdown, { maxLines: 2 })).toBe("    code\n\nnext\n\n...")
    expect(buildCollapsedProposedPlanPreviewMarkdown(markdown, { maxLines: 0 })).toBe("Plan")
    expect(buildProposedPlanMarkdownFilename("# Client's [JSON] / API!")).toBe("clients-json-api.md")
  })

  const plan = [
    "# Custom Plan Mode",
    "",
    "## Summary",
    "Keep planning in the plan UI.",
    "",
    "## Tasks",
    "1. Parse the proposed plan.",
    "2. Render an implementation card.",
    "3. Execute the reviewed plan.",
  ].join("\n")

  it("extracts BetterC0de plan titles and displayed previews", () => {
    expect(proposedPlanTitle(plan)).toBe("Custom Plan Mode")
    expect(stripDisplayedPlanMarkdown(plan)).toBe(
      [
        "Keep planning in the plan UI.",
        "",
        "## Tasks",
        "1. Parse the proposed plan.",
        "2. Render an implementation card.",
        "3. Execute the reviewed plan.",
      ].join("\n")
    )
    expect(
      buildCollapsedProposedPlanPreviewMarkdown(plan, { maxLines: 2 })
    ).toBe(
      ["Keep planning in the plan UI.", "", "## Tasks", "", "..."].join("\n")
    )
  })

  it("builds the BetterC0de implementation handoff prompt", () => {
    expect(buildPlanImplementationPrompt("  # Plan\n\n- Ship it  ")).toBe(
      "PLEASE IMPLEMENT THIS PLAN:\n# Plan\n\n- Ship it"
    )
  })

  it("resolves BetterC0de follow-up submissions", () => {
    expect(
      resolvePlanFollowUpSubmission({
        draftText: "  Adjust this plan first. ",
        planMarkdown: plan,
      })
    ).toEqual({ text: "Adjust this plan first.", interactionMode: "plan" })

    expect(
      resolvePlanFollowUpSubmission({
        draftText: " ",
        planMarkdown: plan,
      })
    ).toEqual({
      text: buildPlanImplementationPrompt(plan),
      interactionMode: "default",
    })
  })

  it("derives implementation title, filename, and export content", () => {
    expect(buildPlanImplementationThreadTitle(plan)).toBe(
      "Implement Custom Plan Mode"
    )
    expect(buildProposedPlanMarkdownFilename(plan)).toBe("custom-plan-mode.md")
    expect(normalizePlanMarkdownForExport("# Plan")).toBe("# Plan\n")
  })

  it("uses BetterC0de's long-plan collapse thresholds", () => {
    expect(shouldCollapseProposedPlan("Short plan\n- Ship it")).toBe(false)
    expect(shouldCollapseProposedPlan("x".repeat(901))).toBe(true)
    expect(
      shouldCollapseProposedPlan(
        Array.from({ length: 21 }, (_, i) => `Line ${i + 1}`).join("\n")
      )
    ).toBe(true)
  })
})
