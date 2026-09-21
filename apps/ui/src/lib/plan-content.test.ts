import { describe, expect, it } from "vitest"
import { isStructuredPlanMarkdown } from "@/lib/message-utils"
import {
  buildBetterC0dePlanJson,
  extractProposedPlanMarkdown,
  parseBetterC0dePlanJson,
  providerPlanStepsToTasks,
  unwrapPlanContent,
  wrapProposedPlanMarkdown,
} from "@/lib/plan-content"

describe("parseBetterC0dePlanJson", () => {
  it("parses the BetterC0de JSON plan contract into editable sections", () => {
    const parsed = parseBetterC0dePlanJson(
      JSON.stringify({
        type: "betterc0de.plan",
        version: 1,
        title: "Custom Plan Mode",
        description: "Make plan mode UI-owned.",
        sections: [
          {
            name: "Parser",
            steps: [
              {
                id: "step-1",
                text: "Parse BetterC0de plan JSON.",
                status: "completed",
              },
              {
                id: "step-2",
                text: "Render the checklist.",
                status: "pending",
              },
            ],
          },
        ],
        links: [{ text: "Docs", href: "https://example.com/docs" }],
      })
    )

    expect(parsed?.title).toBe("Custom Plan Mode")
    expect(parsed?.sections[0]?.name).toBe("Parser")
    expect(parsed?.sections[0]?.steps).toEqual([
      { id: "step-1", text: "Parse BetterC0de plan JSON.", done: true },
      { id: "step-2", text: "Render the checklist.", done: false },
    ])
    expect(parsed?.links).toEqual([
      { text: "Docs", href: "https://example.com/docs" },
    ])
  })

  it("extracts a fenced JSON plan and marks it as structured plan content", () => {
    const content = [
      "Here is the plan:",
      "```json",
      JSON.stringify({
        type: "betterc0de.plan",
        version: 1,
        title: "Plan",
        sections: [
          {
            name: "Tasks / Todos",
            steps: [{ id: "step-1", text: "Do the thing.", status: "pending" }],
          },
        ],
      }),
      "```",
    ].join("\n")

    expect(parseBetterC0dePlanJson(content)?.sections[0]?.steps[0]?.text).toBe(
      "Do the thing."
    )
    expect(isStructuredPlanMarkdown(content)).toBe(true)
  })
})

describe("proposed plan markdown blocks", () => {
  it("extracts and detects BetterC0de proposed plan blocks", () => {
    const content = [
      "ignored preface",
      "<proposed_plan>",
      "# Ship Plan Mode",
      "",
      "## Summary",
      "Use provider-native planning.",
      "</proposed_plan>",
    ].join("\n")

    expect(extractProposedPlanMarkdown(content)).toBe(
      "# Ship Plan Mode\n\n## Summary\nUse provider-native planning."
    )
    expect(unwrapPlanContent(content)).toContain("# Ship Plan Mode")
    expect(isStructuredPlanMarkdown(content)).toBe(true)
  })

  it("does NOT treat plan-mode narration as a structured plan", () => {
    // Preliminary narration in plan mode routinely contains section headers
    // and checkbox lists; without a real <proposed_plan> block / plan JSON it
    // must not be promoted to a plan card.
    const narration = [
      "I'm now in plan mode. Before I write a plan I need to understand the UI.",
      "",
      "## Tasks",
      "- [ ] Read CokeRunnerUI.cs",
      "- [ ] Read the pause menu",
      "- [ ] Map the theme tokens",
      "",
      "## Verification",
      "I'll re-read the files after.",
    ].join("\n")
    expect(isStructuredPlanMarkdown(narration)).toBe(false)
  })

  it("wraps raw provider plan markdown for chat rendering", () => {
    expect(wrapProposedPlanMarkdown("# Plan\n\n- Step 1")).toBe(
      "<proposed_plan>\n# Plan\n\n- Step 1\n</proposed_plan>"
    )
  })
})

describe("provider plan conversion", () => {
  it("converts provider-native plan steps into BetterC0de plan JSON", () => {
    const tasks = providerPlanStepsToTasks([
      { step: "Inspect files", status: "completed" },
      { step: "Patch parser", status: "in_progress" },
    ])
    const content = buildBetterC0dePlanJson({ tasks })
    const parsed = parseBetterC0dePlanJson(content)

    expect(tasks).toEqual([
      { text: "Inspect files", completed: true },
      { text: "Patch parser", completed: false },
    ])
    expect(parsed?.sections[0]?.steps.map((step) => step.text)).toEqual([
      "Inspect files",
      "Patch parser",
    ])
  })

  it("serializes UI-edited plan sections back into the BetterC0de JSON contract", () => {
    const content = buildBetterC0dePlanJson({
      title: "Reviewed Plan",
      description: "Use the edited checklist.",
      sections: [
        {
          name: "Frontend",
          steps: [
            { id: "ui-1", text: "Render the plan card.", completed: true },
            { id: "ui-2", text: "Execute the reviewed plan." },
          ],
        },
        {
          name: "Backend",
          steps: [{ id: "be-1", text: "Preserve provider handoff." }],
        },
      ],
      links: [{ text: "Reference", href: "https://example.com/ref" }],
    })
    const parsed = parseBetterC0dePlanJson(content)

    expect(parsed?.title).toBe("Reviewed Plan")
    expect(parsed?.description).toBe("Use the edited checklist.")
    expect(parsed?.sections).toEqual([
      {
        name: "Frontend",
        steps: [
          { id: "ui-1", text: "Render the plan card.", done: true },
          { id: "ui-2", text: "Execute the reviewed plan.", done: false },
        ],
      },
      {
        name: "Backend",
        steps: [
          { id: "be-1", text: "Preserve provider handoff.", done: false },
        ],
      },
    ])
    expect(parsed?.links).toEqual([
      { text: "Reference", href: "https://example.com/ref" },
    ])
  })
})
